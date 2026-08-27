# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Project overview

`@workglow/sec` is a CLI built on the Workglow AI library that retrieves SEC (EDGAR)
filing data into SQLite or Postgres: CIK names, quarterly/daily indexes, company
submissions, company facts, and individual filing forms (Form D, Form C, Form 1-A, S-1,
424, 8-K, proxies, …). On top of raw ingest it runs AI extraction, an entity
resolution tier, and a derived SPAC lifecycle model.

Companion docs in this repo:

| Doc                         | Covers                                                              |
| --------------------------- | ------------------------------------------------------------------- |
| `ARCHITECTURE.md`           | End-to-end pipeline; how to add a form type                         |
| `SPEC.md`                   | Full CLI reference and data-flow diagrams                           |
| `docs/fetch-and-storage.md` | Fetch layer, EDGAR rate limits, bulk downloads, `db setup`/`reset`  |
| `docs/extraction.md`        | AI extraction, dead letters, per-extractor sections, segmentation   |
| `docs/identity.md`          | Observations, resolvers, normalizers, versioning, re-key ceremonies |
| `docs/spac.md`              | SPAC lifecycle model, candidate screen, backfills                   |
| `docs/eval.md`              | Model comparison harnesses and golden truth                         |
| `docs/verification.md`      | `sec verify`, block source spans, the coverage measure              |

Workglow-wide design specs and plans live in the sibling **PRD repo**
(`prd/docs/superpowers/specs/` and `.../plans/`). Do not reference them from source
comments — they change independently.

## Commands

```bash
bun install
bun run build                # clean + JS + types
bun run dev                  # watch (JS + types)
bun test                     # all tests
bun test src/path/to/file.test.ts
bun run format               # Prettier write — run before pushing
bun run format-check         # CI runs this
bun run typecheck-tests      # typecheck test files
```

CI runs `format-check` → `build` → `test`, cheapest first.

`typecheck-tests` is separate because test files are **excluded from the base
`tsconfig.json`** and vitest transpiles without typechecking — `build` and `test` both
pass over a test file whose types are wrong. It is **not in CI yet**: the suite reports
146 errors across 47 files, and a step that is red the day it lands teaches everyone to
ignore it. Run it locally on files you touch, and wire it into `test.yml` in the change
that gets the count to zero.

The CLI entrypoint is `src/sec.ts` (Commander).

### Command shape

A sync leaf with more than one step is a command **group**, not a command with a
`--step` flag: `sec sync spacs` lists `all | identify | process`, `sec sync spacs all` is
the whole leaf, `sec sync spacs identify` is one step. `sec sync all` runs every `inAll`
leaf. A single-step leaf stays a plain command. The group itself has no action, so asking
what it contains needs no configured database. A leaf declaring `runAll` (see `SyncLeaf`)
runs its steps as ONE task graph, which is what keeps a multi-step leaf a single run in
the progress UI.

### Packaging and local links

**Source is not shipped in the tarball. Do not add `src` back to `files` in
`package.json`** — `prepack-check` guards this and CI fails.

`use-source` is a workspace-local `bun link` flow reading the linked working copy on
disk. It does **not** edit `package.json`: `exports` keeps pointing at `./dist/*` and the
script writes re-export stubs into the gitignored `dist` folder (including a `dist/sec.js`
bin stub), so switching modes leaves `git status` clean. `bun run use-dist` removes the
stubs — identified by a `@workglow-source-stub` sentinel, so real build output is never
deleted — and rebuilds (`--no-build` skips it). Finding no stubs is reported but does
**not** skip the rebuild: `dist/` is gitignored, so "no stubs" usually means it was
deleted. `prepack-check` fails if any stub is still present.

Local Workglow deps: from a libs checkout run `bun run link-all` (usually with
`bun run use-source`), then `bun run link-workglow` here. Register this package for
consumers with `bun run link`. Full chain: `bun ./dev-link.ts` from the parent
`workglow/` folder. **Re-run `link-workglow` after any `bun install`.**

### The `sec-base` binary

The package ships two binaries. `sec` is the data pipeline. `sec-base`
(`src/libs-cli.ts`) is the generic Workglow surface — `task`, `model`, `mcp`, `workflow`,
`agent`, `credential`, `web` — with sec's tasks registered into the global `TaskRegistry`.

```bash
sec-base task list
sec-base task detail QueryFilings
sec-base task run QueryFilings --input-json '{"cik":1018724}'
sec-base web
```

Its body is `runWorkglowCli` from `@workglow/cli`, not a copy. Two things this depends on:

- **`bootstrapSecRuntime`** (`src/config/bootstrapSecRuntime.ts`) is the ONE path that
  brings up sec's runtime — SQLite binding, DI, resolvers, models, providers, started
  fetch queue. Both the `sec` `preAction` hook and `sec-base` call it. A second entrypoint
  booting another way drifts silently, with late and misleading failures (a task resolving
  no model, a fetch with no rate limiter).
- **`registerSecTasks`** (`src/config/registerTasks.ts`) is a **curated** list, not every
  class under `src/task/`. Most of those are pipeline steps that mean nothing invoked
  alone. Add a task here only when it answers a question on its own.

## Architecture

### Layers

- **`src/commands/`, `src/cli/groups/`** — Commander definitions. Every subcommand has the
  same shape: parse args, construct tasks (inputs via the constructor's `defaults`), run
  them through `runWorkflowCli` (`src/cli/runWorkflow.ts`), render the structured output.
  `runWorkflowCli` pipes the tasks plus an `OutputTask` sink into a `Workflow` and executes it
  via `@workglow/cli`'s `withCli` — on a TTY that renders the live `renderWorkflowRun`
  progress UI, when piped it runs plainly — and returns the sink's collected output.
  **Commands hold no business logic** — work lives in tasks, presentation in the command.
  Pass task inputs via `defaults`, never the graph run-input (arrays there can trigger
  fan-out semantics).
- **`src/task/`** — task-graph tasks by domain: `ciknames/`, `facts/`, `forms/`, `index/`,
  `submissions/`, `query/`, `db/`, `versioning/`, `resolve/`, `canonical/`, `spac/`,
  `editorial/`, `offering/`, `fixtures/`, `init/`, `eval/`, `model/`. `taskPorts.ts`
  exports `TaskPorts<T>`, the bridge letting an `interface`-typed result satisfy `DataPorts`.
- **`src/sec/`** — parsing and schemas, `forms/` split per form category. Each form type
  has a parser (`.ts`), a TypeBox schema (`.schema.ts`), and optional `.storage.ts`.
- **`src/storage/`** — repository-pattern persistence: `entity/`, `filing/`, `address/`,
  `investment-offering/`, `portal/` (core EDGAR-linked, by CIK); `observation/`,
  `canonical/`, `versioning/` (the identity tier — see `docs/identity.md`).
- **`src/config/`** — DI. `tokens.ts` defines tokens, `EnvToDI.ts` reads env,
  `storageRegistry.ts` declares every tabular storage as one
  `{ token, table, schema, primaryKeyNames, indexes, uniqueIndexes }` list.
- **`src/types/edgar/`** — TypeScript types for raw EDGAR API responses.
- **`src/util/`** — `db.ts` (SQLite connection + prepared statement cache),
  `sqlBackend.ts`, data cleaning helpers.

**Every task class declares `static readonly title`** — the CLI progress UI labels rows
with it. `taskTitles.test.ts` fails the build without one. When a graph runs several
instances of one class, or the parameters are what distinguish them, pass a per-instance
`title` in the task config (`Download submissions`, not two identical
`BootstrapDownloadTask` rows). Name an owned graph through the second argument:
`context.own(new Workflow(), { title })`.

### Adding a table

Add one `defineStorage({...})` entry to `storageRegistry.ts`, plus its `setupDatabase()` /
`deleteAll()` call in `setupAllDatabases.ts` / `resetAllDatabases.ts` — coverage tests
enforce both against the registry. `DefaultDI.ts` builds each entry through
`createStorage` (SQLite/Postgres → `SqliteTabularRepository` and friends);
`src/config/TestingDI.ts` builds each as `InMemoryTabularRepository`. DI is the `workglow`
package's `globalServiceRegistry` with typed tokens; call
`resetDependencyInjectionsForTesting()` in test setup.

### Schema pattern

Schemas use TypeBox (v1, imported as `typebox`). Each storage module exports a schema
(`AddressSchema`), primary key name constants (`AddressPrimaryKeyNames`), a DI token
(`ADDRESS_REPOSITORY_TOKEN`), and a repo class with domain-specific methods.

### Temporal design: history + current state

The dataset's value is showing how filings change data **over time** alongside a queryable
**current state**:

- **Per-filing / append-only tables** (offering histories, observations, XBRL facts,
  `spac_event`, `spac_deal`) are keyed by accession or filing date and are never
  overwritten by a later filing. They are the time series.
- **Mutable "current" rows** (`Crowdfunding`, `Portal`, `RegAOffering`, `spac`) must
  reflect the latest filing **by filing date, not processing order**. Every write guards
  against out-of-order processing (skip when the incoming `filing_date` is older than the
  row's as-of date; unknown dates apply as-is) and **merges** fields the newer filing does
  not carry rather than clobbering them with nulls.
- **History tables** (`CrowdfundingHistory`, `spac_history`, `ChangeLog`) version the
  mutable rows so point-in-time state stays reconstructable.
- These guards are what make replays idempotent and order-safe. When an extractor bug
  corrupts data midway through a CIK, the recovery is to re-process the whole CIK
  (version bump → re-extract).

## Cross-cutting rules

These apply everywhere and are the ones worth carrying into every change.

**Enforce invariants in code, never in the prompt.** A model instruction is a request; a
guard is a fact. Where a model could return something downstream must not persist — an
ownership-table subtotal row, a category heading returned as a risk, a proxy that merely
_recites_ a combination — the check lives in the persist path or a deterministic scan, not
only in the prompt. False positives here corrupt the primary answer with no trace.

**One bad filing never aborts a sweep.** Extraction failures are recorded as dead letters
and the run returns `{ success: false }`; cooperative cancellation (Ctrl-C) is re-thrown
rather than dead-lettered, so an interrupted sweep does not stamp version-gated failures on
filings it merely stopped mid-flight. See `docs/extraction.md`.

**A recorded successful run is what stops a filing being re-selected.** Handlers that
no-op behind a gate (known-SPAC checks) still record success, so recovering them needs a
descriptor that widens or replaces the anti-join — never a bare re-run. See
`docs/spac.md`.

**`getDb()` is SQLite-only** and throws `SecCliConfigurationError` when
`SEC_DB_TYPE !== "sqlite"`. Before that guard it would silently open a stray SQLite file
under Postgres, and rows written through it never reached the configured backend.

**Raw SQL goes through `resolveSqlBackend(access, repo)`** (`src/util/sqlBackend.ts`):
SQLite → `getDb()`, Postgres → `getPgPool()`, otherwise the repository. Both parameters
are required so each call site states its intent. Two guards force the repository path:

- **Dry run, `access: "write"` only.** `--dry-run` is enforced by `createStorage` wrapping
  storages in `ReadOnlyTabularStorage`; a raw-SQL write goes around that wrapper and would
  commit for real. A raw-SQL **read** commits nothing, and demoting it would be a silent
  pessimisation, so reads keep the fast path.
- **A non-durable repo — pass the repo whenever you have one.** An in-memory store is
  invisible to `getDb()`/`getPgPool()`, so a fast path would target a different store. This
  is reachable in one process, not just across test files: `EnvToDI` defaults `SEC_DB_TYPE`
  to `"sqlite"` and `.env.test` supplies the folder/name, so anything holding an in-memory
  repo can still satisfy every token check. (Across test _files_ the registry is already
  clean — `resetDependencyInjectionsForTesting` strips these `ENV_DERIVED_TOKENS` and vitest
  isolates with `pool: "forks"`.)

  Call sites: `cikNameBulkWriter.ts`, `Form8KEventReplace.ts`, `SpacDealReplace.ts` (writes);
  `feedFilings.ts` (reads). The raw **DDL** in `setupAllDatabases.ts` / `resetAllDatabases.ts`
  is not a fast path and keeps its own `isDryRun()` guard.

**A bulk read is not a reason to reach for raw SQL.** `ITabularStorage` expresses set
membership directly — `query({ col: { value: [...], operator: "in" } })` — so "rows for
these N ids" is one query on every backend (`PersonObservationTitleRepo.listForObservations`
is the worked example). Chunk only because SQLite binds one parameter per value.

**Every Postgres identifier is schema-qualified to `current_schema()`** (`quote` /
`currentSchemaName` in `src/util/pgIdentifiers.ts`). Unqualified names resolve through
`search_path` and would reach a same-named table in another schema — the hazard applies to
DDL, drops, catalog probes and row-count estimates alike.

**Extraction samples greedily.** Every model call sends `temperature: 0`
(`SEC_EXTRACTION_TEMPERATURE`). Extraction is transcription — the answer is already in the
filing — and unpinned sampling made re-processing one filing yield 138/138/109 risk factors
whose contents differed all three times.

## Environment variables

Set in `.env.local` (see `.env.test` for test defaults).

| Var                                                                               | Meaning                                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `SEC_RAW_DATA_FOLDER`                                                             | Path to raw downloaded data                                                         |
| `SEC_DB_FOLDER` / `SEC_DB_NAME`                                                   | SQLite directory / database name (default `edgar`)                                  |
| `SEC_DB_TYPE`                                                                     | `"sqlite"` (default) or `"postgres"`                                                |
| `SEC_PG_URL`                                                                      | Postgres connection string (takes precedence over the individual vars)              |
| `SEC_PG_HOST`, `SEC_PG_PORT`, `SEC_PG_USER`, `SEC_PG_PASSWORD`, `SEC_PG_DATABASE` | Individual Postgres settings (defaults `localhost`, `5432`, `edgar`)                |
| `SEC_FETCH_MAX_PER_SEC`                                                           | EDGAR fetch **rate**, req/s, shared cluster-wide (default 4, clamped 1–8)           |
| `SEC_FETCH_MAX_CONCURRENT`                                                        | EDGAR fetches **in flight**, per process (default 4, clamped 1–64)                  |
| `SEC_FIXTURES_DIR`                                                                | Root for the gitignored fixture cache (default cwd)                                 |
| `SEC_S1_MOCK_DIR`                                                                 | Override the committed S-1 fixtures directory                                       |
| `SEC_UNIT_TERMS_REF`                                                              | Override the embarc unit-terms reference CSV                                        |
| `SEC_EXTRACTION_TEMPERATURE`                                                      | Sampling temperature for every extraction call (default `0`)                        |
| `SEC_MODEL_DEFAULT` + per-extractor overrides                                     | Extraction models (built-in default `DEFAULT_SEC_MODEL`) — see `docs/extraction.md` |

The two fetch limits are **independent and both needed**: the rate limiter meters starts
over a one-second window and its reservations age out rather than being held to completion,
so on its own it admits `rate × latency` requests — a slow EDGAR serving multi-MB documents
at 30s each puts fetches in flight in the hundreds, and at roughly two descriptors apiece
that exhausts the process's descriptor table (macOS's default `ulimit -n` of 256 goes
first). The concurrency limiter holds its slot until the job is terminal, which is what
bounds the peak. The default 4 matches the rate cap, so a process cannot hold more in flight
than it may start in a second, and the cap binds once a fetch averages over one second — a
healthy sweep is unaffected. Retries re-enter through the queue rather than re-issuing
in-job, so they cannot bypass either cap; see `docs/fetch-and-storage.md`.

## TypeScript conventions

From `.cursor/rules/`:

- Use **Bun** (`bun test`, `bun run`)
- **No default exports**; **no enums** — `as const` objects instead
- **`import type`** for type-only imports; merge when mixed with value imports
- **`interface extends`** over `&` intersections
- **`readonly`** properties by default
- **Explicit return types** on top-level module functions (except JSX components)
- **`string | undefined`** over `?: string` — force explicit passing
- **Discriminated unions** for variant data
- `as any` only inside generic function bodies where TS cannot narrow
- Concise JSDoc only when behavior is non-obvious; `@link` for cross-references

## Formatting

Prettier: 100 char width, 2-space indent, double quotes, trailing commas (es5), semicolons.
Enforced by `bun run format-check` in CI, so run `bun run format` before pushing. The
version is **pinned exactly** (not a range): a floating range reformats on a minor release
and turns CI red on a day nobody touched the code.

Two `.prettierignore` entries are load-bearing — do not tidy them out:

- **Every `mock_data/` directory.** These are captured EDGAR bytes, not source.
  `goldenFixtures.test.ts` re-hashes the `src/sec/html/mock_data/{s1,424}` corpus against
  SHA-256 digests in `goldenFixtureManifest.ts`, so reformatting a fixture turns that test
  red and destroys the capture provenance (a bare `prettier --write .` rewrites 28 of them).
  Other `mock_data/` trees back whitespace-sensitive prose segmentation and source-span
  verification, where re-indenting changes what the tests measure. The entry names the
  directories, not the files that fail today.
- **`src/eval/goldenS1Labels.ts`** — one label per line so each can be checked against the
  filing it came from. Prettier collapses them; 19,950 of the 21,757 lines a repo-wide
  reformat would change are in this one file.
