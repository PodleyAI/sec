# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Project overview

`sec` is the worked example of the Workglow libraries: a CLI that pulls SEC EDGAR
and Form ADV data into SQLite or Postgres, converts filings to markdown, reads the
inline XBRL out of them, and answers questions about the prose with citations.

**It used to be the base layer a private product extended.** That product —
`embarc-data` — absorbed the source and no longer depends on this package, so
everything that existed to serve it is gone: the AI extraction tier, the
identity/canonical tier, extractor versioning and dead letters, the SPAC model, the
Form D/C/1-A storage tiers, and the ten registration seams a superset contributed
through. If a comment or a doc says something "ships in a consumer package" or
arrives "through a registration seam", it is stale — check before believing it.

The only external boundary is `@workglow/*`, developed in a sibling `libs` checkout
and consumed through the `workglow` meta package.

| Doc | Covers |
| --- | --- |
| `README.md` | The ten-minute path, the command table, and which package does what |
| `ARCHITECTURE.md` | The pipeline end to end; adding a table, a stage, or a form |
| `docs/fetch-and-storage.md` | The fetch layer, EDGAR's rate limits, bulk downloads |

Workglow-wide design specs and plans live in the sibling **PRD repo**
(`prd/docs/superpowers/specs/` and `.../plans/`). **Never reference a plan, spec,
PRD, PR number or review finding from a source comment** — they change
independently, and a comment must explain the code in front of it.

## Commands

```bash
bun install
bun run build                # bundles the two binaries
bun run typecheck            # tsc --noEmit over src, scripts AND tests
bun run test                 # vitest run
bunx vitest run <file>       # what you normally want — the full suite is slow
bun run lint                 # oxlint + tsgolint type-aware rules; CI runs this
bun run format               # oxfmt write — run before pushing
```

CI runs `format-check` → `lint` → `typecheck` → `build` → `test`, cheapest first.

**Tests are vitest with `pool: "forks"` and `isolate: true`.** Run them with
`bunx vitest run`, never `bun test`: the Bun shim does not give each file a fresh
module registry, so `globalServiceRegistry` leaks between files.

**Node 24, Bun 1.4+.** `node:sqlite` backs the SQLite storage and is neither stable
nor unflagged below those. A subprocess CLI test on an older Bun fails with what
reads like a storage bug.

There is one tsconfig covering src, scripts and tests. It emits nothing — the
binaries bundle — so there is no declaration build to keep tests out of.

## The CLI

Ten commands, named for intent and registered in the order a first reader should
meet them: `setup`, `status`, `get`, `update`, `load`, `show`, `read`, `index`/`ask`,
`fetch`, `db`, plus `web` from `@workglow/cli`. The old names are aliases: `init`,
`sync`, `bootstrap`, `query`.

Three verbs for getting data, separated by **scope**: `get` one company, `update`
what you already have, `load` everything.

**Guidance is one mechanism.** `suggest({ command, why })` collects steps;
`runCommand` drains and renders them under the output, suppressed by `--quiet` and
left as data under `--json`. A failed command suggests nothing. When you add a
command, end it with the obvious next move — and use the same command strings
`sec status` prints, so the map and the suggestions stay one vocabulary.

**A command holds no business logic.** Parse args, construct tasks (inputs through
the constructor's `defaults`, never the graph run-input — an array there can
trigger fan-out), run them through `runWorkflowCli`, render the result.

**Every task class declares `static readonly title`.** `taskTitles.test.ts` fails
the build without one, because that is what the progress UI labels the row with.

`commandsBoot.test.ts` pins the top-level tree and the sync leaves. A leaf dropped
from `registerSecSyncLeaves` is otherwise invisible — the group still builds.

## Architecture

- **`src/cli/`** — the runtime around the commands: `runCommand`, `runWorkflow`,
  `nextSteps`, `resolveCompany`, `loadCosts`, `groups/`, `queries/`, `sync/`.
- **`src/task/`** — tasks by domain: `fetch/`, `bootstrap/`, `index/`,
  `submissions/`, `facts/`, `document/`, `adv/`, `kb/`, `query/`, `db/`, `verify/`.
- **`src/sec/`** — parsing. `html/` is the filing parser and segmenter, `xbrl/` the
  inline-XBRL reader, `forms/` the form dictionary (metadata classes only — the
  parsers that wrote to storage went with the extractors), `adv/` the CSV reader.
- **`src/storage/`** — one directory per domain, TypeBox schemas plus repos.
- **`src/kb/`** — the SQLite-backed knowledge base `ask` reads.
- **`src/config/`** — DI. `tokens.ts`, `EnvToDI.ts`, `storageRegistry.ts`,
  `models.ts`.
- **`src/web/`** — what the console shows for these commands.

### Adding a table

One `defineStorage` entry in `src/config/storageRegistry.ts`. Nothing else:
`setupAllDatabases`, `resetAllDatabases`, `db stats` and the schema passes all loop
that list. `TestingDI` binds every entry as in-memory; call
`resetDependencyInjectionsForTesting()` in test setup.

## Cross-cutting rules

**`bootstrapSecRuntime` is the one path that brings up the runtime** — the SQLite
binding, DI, models, providers, the started fetch queue. Both binaries call it. A
second entrypoint booting another way drifts silently, with late and misleading
failures (a task resolving no model, a fetch with no rate limiter).

**`registerSecTasks` is a curated list**, not every class under `src/task/`. A task
earns its place there by answering a question on its own.

**`getDb()` is SQLite-only** and throws when `SEC_DB_TYPE` is not sqlite. Before
that guard it would open a stray SQLite file under Postgres, and rows written
through it never reached the configured backend.

**Raw SQL goes through `resolveSqlBackend(access, repo)`.** Both arguments are
required so each call site states its intent. Two guards force the repository path:
a **dry run** with `access: "write"` (raw SQL goes around the `ReadOnlyTabularStorage`
wrapper and would commit for real), and a **non-durable repo** (an in-memory store
is invisible to `getDb()`, so a fast path would target a different store). Raw DDL
in `setupAllDatabases` / `resetAllDatabases` keeps its own `isDryRun()` guard.

**A bulk read is not a reason to reach for raw SQL.** `ITabularStorage` expresses
set membership directly — `query({ col: { value: [...], operator: "in" } })`. Chunk
only because SQLite binds one parameter per value.

**Every Postgres identifier is schema-qualified to `current_schema()`** (`quote` /
`currentSchemaName`). An unqualified name resolves through `search_path` and can
reach a same-named table in another schema.

**One rule decides which FILE a filing is fetched as**: `submissionFetchKind`
(`src/task/document/submissionFetchPolicy.ts`). Registration and prospectus forms,
Reg A annual reports, and **every 8-K** are fetched as the full-submission `.txt`;
everything else as its primary document. 8-K is unconditional because its primary
document is routinely four sentences pointing at the EX-99.1 that carries the news
— for that form the exhibits *are* the filing, and only the `.txt` has them.

**`FILING_CONVERTER_VERSION` is the only version knob left.** Bump it by hand after
a parser change to re-select already-converted filings; never truncate, since a
half-finished re-run then leaves the old rows readable.

## Environment variables

Set in `.env.local`; `.env.test` carries the test defaults. `sec setup` writes the
first few.

| Var | Meaning |
| --- | --- |
| `SEC_RAW_DATA_FOLDER` | Downloaded archives, the document cache, the ONNX weight cache |
| `SEC_DB_FOLDER` / `SEC_DB_NAME` | SQLite directory / database name (default `edgar`) |
| `SEC_DB_TYPE` | `"sqlite"` (default) or `"postgres"` |
| `SEC_PG_URL` or `SEC_PG_HOST`/`PORT`/`USER`/`PASSWORD`/`DATABASE` | Postgres settings |
| `SEC_SQLITE_CACHE_MB` | Page-cache ceiling for the one shared connection (2–4096) |
| `SEC_USER_AGENT` | EDGAR requires a descriptive one; a compiled-in default applies |
| `SEC_FETCH_MAX_PER_SEC` | EDGAR request **rate**, shared cluster-wide (default 4, 1–8) |
| `SEC_FETCH_MAX_CONCURRENT` | Requests **in flight**, per process (default 4, 1–64) |
| `SEC_FETCH_TIMEOUT_MS` | Per-attempt timeout — time *without progress*, not elapsed |
| `SEC_MODEL` | Generation model for `ask`; unset resolves by which API key is present |
| `SEC_EMBEDDING_MODEL` | Embedding model — changing it invalidates the index |
| `SEC_ONNX_DEVICE` | `cpu` (default) or `webgpu` where there is an adapter |
| `SEC_FIXTURES_DIR`, `SEC_S1_MOCK_DIR` | Fixture roots |

The two fetch limits are **independent and both needed** — see
`docs/fetch-and-storage.md`.

## TypeScript conventions

- **No default exports**; **no enums** — `as const` objects, derive with `keyof typeof`
- **`import type`** for type-only imports; merge when mixed with value imports
- **`interface extends`** over `&` intersections
- **`readonly`** by default; **`T | undefined`** over `T?`
- **Explicit return types** on top-level module functions
- **Discriminated unions** for variant data
- `as any` only inside generic function bodies where TS cannot narrow
- Concise JSDoc only where behavior is non-obvious; comments explain **why**

## Formatting and linting

`oxfmt`: 100 cols, 2-space, double quotes, es5 trailing commas. `oxlint` with
`oxlint-tsgolint` for the type-aware rules, scoped to `src` and `scripts`.

**Every `mock_data/` entry in `.oxfmtrc.json` is load-bearing.** These are captured
EDGAR bytes, not source: `goldenFixtures.test.ts` re-hashes the
`src/sec/html/mock_data` corpus against SHA-256 digests, so reformatting a fixture
turns that test red and destroys the capture provenance. Other trees back
whitespace-sensitive segmentation and source-span checks.
