# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@workglow/sec` is a CLI tool built on the Workglow AI library for retrieving and storing SEC (EDGAR) filing data into a local SQLite database. It fetches CIK names, quarterly/daily indexes, company submissions, company facts, and individual filing forms (Form D, Form C, Form 1-A, etc.).

Workglow-wide design specs and implementation plans live in the PRD repository: `/workspaces/workglow/prd/docs/superpowers/specs/` and `/workspaces/workglow/prd/docs/superpowers/plans/`.

## Commands

```bash
bun install                  # Install dependencies
bun run build                # Full build (clean + JS + types)
bun run dev                  # Watch mode (JS + types concurrently)
bun test                     # Run all tests
bun test src/path/to/file.test.ts  # Run a single test file
```

The CLI entrypoint is `src/sec.ts` and uses Commander for subcommands (e.g., `./src/sec.ts company-submissions 1018724`).

### PR4 CLI additions

```bash
# Run the resolver over all observations for a given kind
sec resolve --kind person --resolver-version 1.0.0 --all
sec resolve --kind company --resolver-version 1.0.0 --all

# Alias management (person; same flags for company)
sec canonical person alias "<from-name>" "<into-name>" --reason "merged duplicate"
sec canonical person alias-remove "<name>"
sec canonical person alias-list
sec canonical person alias-list --orphans     # names whose target no longer exists

# Coverage and cleanup
sec version coverage resolver person
sec version coverage resolver company
sec version drop-previous resolver person
sec version drop-previous resolver company
sec version drop-previous extractor <extractor-id>
```

### S-1 extraction

S-1 prospectuses are narrative HTML (not structured XML), so the `S-1` extractor
parses the SGML header deterministically and uses AI structured generation to
extract management, beneficial-ownership, and related-party entities/figures.

```bash
# Fetch + AI-extract S-1 management / beneficial-ownership / related-party data
sec fetch form <cik> S-1

# Dead-letter worklist (version-fixable extraction failures, per filing+section)
sec extractor dead-letters S-1             # list pending entries
sec extractor dead-letters S-1 --eligible  # count entries eligible for retry
sec extractor retry-dead-letters S-1       # re-run filings eligible under the current version
```

`sec version promote extractor S-1` announces how many dead-letter entries became
eligible. Configure the model via `SEC_S1_MODEL` (default `claude-sonnet-5`)
and an optional confidence floor via `SEC_S1_CONFIDENCE_FLOOR`. All extractors
share a general default model (`SecModelDefault` in `src/config/Constants.ts`);
set `SEC_MODEL_DEFAULT` to change every extractor at once, and a per-extractor
env var (e.g. `SEC_S1_MODEL`) to override just one. CLI startup registers these
model ids (the default plus any set overrides, plus the local HFT default
`SecHftModelDefault`) into the global model repository via `registerSecModels`
(`src/config/registerModels.ts`). `secModelRecord` dispatches on id shape — a
HuggingFace `org/name` id → an `HF_TRANSFORMERS_ONNX` record, otherwise an
`ANTHROPIC` record — and both explicitly declare the `json-mode` capability
`StructuredGenerationTask` gates on (the installed provider's capability
inference doesn't recognize newer ids like `claude-sonnet-5`). So
`getGlobalModelRepository().findByName(id)` resolves any of them. Startup also
registers the AI **providers** via
`registerSecProviders` (`src/config/registerProviders.ts`): Anthropic inline
(`provider: "ANTHROPIC"`; needs `ANTHROPIC_API_KEY` at run time) and
HuggingFace Transformers ONNX **worker-backed** (`provider: "HF_TRANSFORMERS_ONNX"`;
the heavy graph runs in `src/config/hftWorker.ts`, never the main thread) — so a
local model can be compared against the cloud path. Each provider registers
defensively (a load failure warns and is skipped). Absent a working provider /
key, each AI section dead-letters instead of aborting the filing.

A `MODEL_RESOLUTION_ERROR` dead-letter (model/provider was unavailable) is
retryable under the **same** extractor version — `retry-dead-letters` recovers it
once the model/provider is registered, no version bump required
(`MODEL_ERROR_REASON_CODES` in `ExtractionDeadLetterSchema.ts`). Every other reason
code stays version-gated (fix the extractor, bump the version, then retry).

### Model comparison harness

`sec eval extract` compares extraction models on **correctness, speed, and cost**
so you can find the cheapest/fastest model that still extracts correctly. It runs
committed golden fixtures (`src/eval/fixtures.ts` — realistic section prose with
hand-authored `expected` rows) through each candidate model and ranks them:

```bash
sec eval extract                              # default 3-way: haiku, sonnet, local LFM2.5-350M
sec eval extract --models "claude-haiku-4-5,onnx-community/Qwen3-4B-Instruct-2507-ONNX"
sec eval extract --extractor management --format json
```

The registered local model (`SecHftModelDefault`) is LiquidAI **LFM2.5-350M** — an
edge-optimized model that reaches ~100% entity recall with valid schema in seconds
per call, far outrunning much larger models on CPU (it beats Qwen2.5-0.5B/1.5B on
accuracy and is ~50x faster than Qwen3-4B, which only matches it at minutes per
call). It is fast enough to sit in the default 3-way. For a stronger-but-slow
local baseline set `SEC_HFT_MODEL=onnx-community/Qwen3-4B-Instruct-2507-ONNX`.
Only **non-thinking** instruct models work for `json-mode` — a thinking model
wraps the JSON in reasoning.

> HFT chat-template workaround: transformers.js 4.2.0 bundles jinja **0.5.6**,
> which predates the `{% generation %}` template-tag strip, so newer templates
> (e.g. the LFM2.5 family's `{%- generation -%}` markers) otherwise throw
> `Unknown statement type: generation`. `hftWorker.ts` calls
> `patchHftChatTemplateGenerationTags` (`src/config/patchHftChatTemplate.ts`)
> to strip those inert training-only markers before the tokenizer compiles the
> template. Remove once the provider's transformers.js bundles a newer jinja.

- **Correctness** — `scoreExtraction` (`src/eval/scoreExtraction.ts`) aligns candidate
  rows to `expected` by a key field (e.g. `full_name`) and scores field-level agreement,
  normalized (case/whitespace) and forgiving of provenance fields. Reports `score`
  (names + titles), `found` (entity recall), and `prec` (1 − hallucinated rows).
- **Cost** — the generation task exposes no token usage, so cost is **estimated**
  (`src/eval/modelPricing.ts`: ~4 chars/token × public per-M pricing; local models $0).
  Absolute dollars are approximate; the ranking is what matters.
- **Speed** — measured wall-clock latency per extraction.

Models are registered on demand via `registerModelIds`, so any candidate id works;
a model that fails to resolve or errors on a fixture is recorded as a failed run
rather than aborting the sweep. Add an extractor by registering it in
`EVAL_EXTRACTORS` and adding a matching fixture. The scorer and pricing are unit-
tested; the live run makes real Anthropic calls (and downloads the ONNX model on
first HFT use).

### Company facts outcome tracking

`processed_facts` rows carry `reason_code` / `detail` / `attempts`. A companyfacts
404 (the entity has no XBRL data — most filer CIKs) is recorded as a *successful*
`NO_XBRL_FACTS` outcome and never retried. `FETCH_ERROR` (transient HTTP/network),
`PARSE_ERROR` (code-fixable), and `STORE_ERROR` rows are failures; `attempts`
counts consecutive failures and resets on success.

```bash
sec update facts --retry-failed   # also re-fetch CIKs whose last facts processing failed
```

A curated sample of real S-1 prospectus HTML (incl. ≥3 SPACs, SIC 6770) is
committed under `src/sec/html/mock_data/s1/` (see its `SOURCES.md`) and exercised
by `parseEdgarHtml.golden.test.ts`. To refresh / grow the sample on demand into a
gitignored cache:

```bash
sec fetch s1-fixtures                 # ~10 real S-1s (>= 3 SPACs) -> mock_data/s1/.cache/
sec fetch s1-fixtures -c 20 --min-spac 5
```

#### iXBRL / XBRL facts

Modern S-1s embed inline XBRL (`ix:nonFraction` / `ix:nonNumeric` facts against the
`dei`, `us-gaap`, and `spac` taxonomies); older submissions may carry a standalone
XBRL instance document (`EX-101.INS`); and since the filing-fee modernization the
fee table is a separate `EX-FILING FEES` exhibit tagged against the `ffd` taxonomy
(it includes `ffd:MaxAggtOfferingPric` / `ffd:TtlOfferingAmt` — the registered
offering size as a deterministic fact). `src/sec/xbrl/` parses these into a shared
fact/context/unit model (no taxonomy/linkbase processing), and `processFormS1`
runs this deterministic pass before AI extraction:

- every fact is persisted to the `xbrl_fact` table (`src/storage/xbrl/`), keyed
  `(accession_number, fact_index)` with the context period/dimensions and resolved
  unit denormalized onto the row; fee-exhibit facts share the accession with
  `source = "fee-exhibit"` and continue the primary document's `fact_index` sequence;
- the dei cover-page facts (registrant name, incorporation state, address, phone)
  upgrade the issuer company observation (`source_context.attributes_source = "xbrl-dei"`);
- XBRL failures never abort the filing — extraction degrades to the untagged path.

`parseToBlocks` skips `display:none` subtrees so the hidden `ix:header` metadata
block does not leak into the prose handed to the AI section extractors.

**424 prospectuses** (`424A`, `424B1`–`424B5`, `424B7`; extractor id `424`) run
`processForm424`: every variant gets the deterministic XBRL pass (pay-as-you-go
424B2s carry `ffd:NrrtvMaxAggtOfferingPric` and `ffd:RegnFileNb`, which ties the
prospectus back to its registration file number) and an issuer observation that
resolves to the same canonical company as the registration statement
(`relation: "424:issuer"`). The **priced** forms (`424B1` / `424B4`) additionally
run the AI offering sections — offering terms, underwriters, use of proceeds —
recording the **final** deal under extractor id `424`, alongside the S-1's
registered/anticipated terms (compare `spac_unit_terms` / `offering_terms` rows
across the two extractor ids). Fee-prepaid 424s (e.g. SPAC 424B4s under Rule
456(a)) carry no fee exhibit and no XBRL; when the prospectus body is untagged,
the fee exhibit's dei facts are the cover-page fallback for issuer enrichment.
The offering-sections logic and the per-section dead-letter ceremony are shared
with the S-1 processor (`s1/offeringSections.ts`, `s1/sectionRunner.ts`).

```bash
sec fetch form <cik> 424B4        # fetch + process a priced prospectus
```

```bash
# Stored XBRL facts for a filing
sec query xbrl <accession> [--concept TrustAccount] [--numeric-only] [--format json]
```

The committed Churchill Capital Corp XII fixture (`s1_2114227_...htm`, a 2026 SPAC
with full `spac`-taxonomy tagging) pins the parser via `parseXbrl.golden.test.ts`.

#### Offering terms / underwriters / use of proceeds

S-1/F-1 prospectuses also yield the deal itself: offering terms (equity →
`offering_terms`, SPAC units → `spac_unit_terms`), a point-in-time exact ticker
series (`issuer_ticker`, distinct from the mutable submissions-API `entity_tickers`),
use-of-proceeds line items, and underwriters on the company tier rolled up to an
`underwriter-family` resolver tier (mirroring sponsor families). The segmenter
recognizes focused `The Offering` / `Underwriting` / `Use of Proceeds` / `The Sponsor`
sections; the last one also gives SPAC sponsor extraction a dedicated home (it falls
back to concatenated section text when the heading is absent).

```bash
# IPOs underwritten by a family (alias-aware)
sec underwriter by-family "Goldman Sachs"

# Underwriter-family alias management
sec canonical underwriter-family alias "<from>" "<into>" --reason "subsidiary"
sec canonical underwriter-family alias-remove "<name>"
sec canonical underwriter-family alias-list [--orphans]

# Point-in-time ticker series for an issuer
sec issuer tickers <cik>

# Registered (S-1) vs final priced (424B1/424B4) terms, with deltas
sec issuer deal <cik> [--format json]
```

> Note: the version ceremonies `coverage` / `drop-previous` and the batch `resolve`
> command are **not** supported for the family-tier resolver kinds
> (`underwriter-family`, `sponsor-family`) — they intentionally error rather than
> operate on the company tier. Family-tier coverage/purge wiring is deferred (see the
> status doc's deferred cleanups).

### SPAC consolidated report

A CIK-keyed `spac` row consolidates the SPAC lifecycle for a quick report:
status, three-era names/SIC/tickers (`spac_*` / `post_merger_*` / `current_*`),
amounts (`ipo_proceeds`, `trust_amount`, `pipe_amount`, `total_redemption_amount`),
and rolled-up key dates. It is **derived** from two append-only tables — `spac_deal`
(one row per business-combination attempt) and `spac_event` (the dated timeline) —
so replays are idempotent; an `as_of` guard protects filing-sourced scalar fields
from out-of-order writes, and `spac_history` + `ChangeLog` version the row.

The IPO half is populated from S-1/DRS (`registration`) and priced 424B1/424B4
(`ipo`). De-SPAC **milestone dates** are populated deterministically from 8-K
item codes (known SPACs only — a `spac` row must already exist): item `1.01` →
`definitive_agreement`, `1.02` → `terminated`, `2.01` → `completed`, `5.07` →
`vote`. These group into `spac_deal` attempts via `deriveDeals`
(recomputed from the event stream on every write, so `deal_index` is stable
across replays) and roll up automatically. `target_name`, `pipe_amount`, and
redemption amounts stay null until the narrative/AI extractors (S-4 / DEFM14A /
425) land — 8-K item codes carry no names or amounts. Still deferred: name/SIC/
ticker transitions and Form 25/15 de-registration.

**Merger proxies** (`DEFM14A`/`PREM14A`, the `DEFM14C`/`PREM14C` consent statements,
and the `DEFR14A`/`PRER14A` revised proxies; extractor id `merger-proxy`) run
`processMergerProxy` (known SPACs only — a `spac` row must already exist): AI
extraction over the merger / business-combination / PIPE sections records a
per-accession `spac_merger_extraction` row (target name/CIK, PIPE amount, merger
consideration) and observes the target company (`relation: "merger-proxy:target"`,
`target_cik` resolved from the canonical company when it has one). `deriveDeals`
correlates each extraction onto the matching `spac_deal` by filing-date window —
*deriving* `target_name` / `target_cik` / `pipe_amount` (a later filing supersedes
an earlier one — definitive over preliminary, revised over definitive), which
retires the 8-K path's positional merge-preserve. Only the **definitive merger**
statements `DEFM14A` and `DEFM14C` emit the `proxy` event (→ `proxy_date` /
`status = proxy`): a consent deal (14C) has no `8-K 5.07` vote, so the definitive
14C is its only approval-stage signal. Preliminary (`PREM14A`/`PREM14C`) and revised
(`DEFR14A`/`PRER14A`) proxies are extraction-only. S-4 is deferred (newco-CIK linkage). Configure the
model via `SEC_MERGER_PROXY_MODEL` (default `claude-sonnet-5`) and an optional
confidence floor via `SEC_MERGER_PROXY_CONFIDENCE_FLOOR` (falls back to the shared
`SEC_S1_CONFIDENCE_FLOOR` when unset).

A proxy ingested before its issuer's `spac` row exists (e.g. the S-1 lands later)
hits the known-SPAC gate and no-ops — recording a successful run, so the normal
unprocessed-run sweep never revisits it. `sec spac backfill-merger-proxies`
recovers these: it re-processes known-SPAC merger proxies that still lack a
`spac_merger_extraction` row (mirroring `backfill-redemptions`).

```bash
sec fetch form <cik> DEFM14A             # fetch + extract a merger proxy
sec spac backfill-merger-proxies         # recover proxies gated before their spac row existed
sec extractor dead-letters merger-proxy  # version-fixable extraction failures
sec extractor retry-dead-letters merger-proxy
```

**Redemption actuals** (extractor id `redemption`) are AI-extracted from a known
SPAC's post-vote 8-K narrative. When an 8-K carries item `5.07`, `2.01`, or `8.01`
for a known SPAC, ingestion escalates the fetch to the full submission `.txt` and
reads the primary document + `EX-99.x` exhibits; `processRedemption8K` records a
per-accession `spac_redemption_extraction` row, and `deriveDeals` correlates
`redemption_amount` / `redemption_shares` onto the matching `spac_deal`. The deal
column is the sole source `total_redemption_amount` sums, so redemptions are counted
once. Configure the model via `SEC_REDEMPTION_MODEL` (default `claude-sonnet-5`)
and an optional confidence floor via `SEC_REDEMPTION_CONFIDENCE_FLOOR` (falls back to
`SEC_S1_CONFIDENCE_FLOOR`).

```bash
sec spac backfill-redemptions            # sweep historical known-SPAC trigger 8-Ks
sec extractor dead-letters redemption    # version-fixable extraction failures
sec extractor retry-dead-letters redemption
```

```bash
sec spac report <cik> [--format json]   # consolidated report
sec spac history <cik> [--format json]  # state-change history
```

### Reg A / Reg CF / funding portals

All 12 Form C submission types (including post-offering C-U / C-AR / C-TR),
the full 1-A family (including 1-A POS), and CFPORTAL portal registrations
parse and store end to end:

```bash
sec fetch form <cik> C-AR          # post-offering Form C variants
sec fetch form <cik> 1-A           # 1-A, 1-A/A, 1-A POS
sec fetch form <cik> CFPORTAL      # portal registration -> Portal table + observations

sec query crowdfunding --portal <portal-cik>
sec query reg-a --tier Tier2 --status reporting
sec query reg-a-summary <cik>      # counts by status/tier + latest aggregate offering
```

Fixtures: `sec fetch fixtures C-U C-AR C-TR` extends the exempt-offering
mock_data tree (note: the quarterly form.idx endpoint may 403 from cloud
containers; the committed fixtures were sourced from EDGAR daily indexes).
CFPORTAL fixtures live under `src/sec/forms/portal/mock_data/cfportal/`.
`isFormParsingSupported` and `FORM_TO_EXTRACTOR_ID` are kept consistent by
`src/sec/forms/form-wiring.test.ts`.

## Architecture

### Temporal design: history + current state

A core value of the dataset is showing both how filings change data **over
time** and a queryable **current state**:

- **Per-filing / append-only tables** (offering histories, crowdfunding
  offerings & disclosure reports, observations, XBRL facts) are keyed by
  accession or filing date and are never overwritten by later filings — they
  are the time series.
- **Mutable "current" rows** (`Crowdfunding`, `Portal`, `RegAOffering`) must
  reflect the latest filing by **filing date**, not by processing order.
  Every write guards against out-of-order processing (skip when the incoming
  `filing_date` is older than the row's as-of date; unknown dates apply
  as-is) and merges fields the newer filing doesn't carry (e.g. a 1-K has no
  tier; a C-AR has no portal CIK) instead of clobbering them with nulls.
- **History tables** (`CrowdfundingHistory` + `ChangeLog`) version the
  mutable rows so point-in-time state stays reconstructable.
- Worst case, when an extractor bug corrupted data midway through a CIK's
  filing set, re-process the whole CIK's filings (version bump →
  re-extract); the guards above make replays idempotent and order-safe.

### Layered Structure

- **`src/commands/`** — Commander CLI command definitions. Each command wires up tasks and invokes them.
- **`src/task/`** — Workglow task graph tasks (fetch, store, process). Organized by domain: `ciknames/`, `facts/`, `forms/`, `index/`, `submissions/`.
- **`src/sec/`** — SEC data parsing and schemas. `forms/` has subdirectories per form category (e.g., `exempt-offerings/`). Each form type has a parser (`.ts`), a TypeBox schema (`.schema.ts`), and optional storage logic (`.storage.ts`). `submissions/` and `indexes/` handle their respective data types.
- **`src/storage/`** — Repository pattern persistence layer. Organized into sub-tiers:
  - **`entity/`, `filing/`, `address/`, `investment-offering/`, `portal/`** — core EDGAR-linked repos (by CIK). Uses junction tables for many-to-many relationships.
  - **`observation/`** — one row per entity mention extracted from a filing, keyed by `(extractor_id, accession_number, observation_index)`. `PersonObservationRepo` and `CompanyObservationRepo` live here. Legacy `person/`, `company/`, and `phone/` tables were replaced by this tier.
  - **`canonical/`** — deduplicated canonical entities (`CanonicalPersonRepo`, `CanonicalCompanyRepo`) with UUID IDs, plus alias tables (`CanonicalPersonAliasRepo`, `CanonicalCompanyAliasRepo`) and identity-link tables (`PersonIdentityLinkRepo`, `CompanyIdentityLinkRepo`) that join observation rows to canonical rows at a specific `resolver_version`. Junction tables for address/phone co-occurrence also live here.
  - **`versioning/`** — `VersionRegistry`, slot ceremonies (`startDev`, `promote`, `rollback`, `dropNext`, `dropPrevious`), extractor run tracking, and semver helpers.
- **`src/fetch/`** — SEC-specific fetch tasks with caching and job queue integration.
- **`src/config/`** — Dependency injection setup. `tokens.ts` defines DI tokens, `EnvToDI.ts` reads env vars, `DefaultDI.ts` registers SQLite-backed repos, `TestingDI.ts` registers in-memory repos.
- **`src/types/edgar/`** — TypeScript types for raw EDGAR API responses.
- **`src/util/`** — Database helpers (`db.ts` manages SQLite connection and prepared statement caching).

### Observations & Resolvers

PR4 introduced an observation/canonical/resolver tier on top of raw form storage. Design spec: `/home/user/prd/docs/superpowers/specs/2026-05-22-sec-versioning-pr4-observation-design.md`.

**Four tiers in order:**

1. **Observation** (`src/storage/observation/`) — raw entity mentions extracted from filings. One row per `(extractor_id, accession_number, observation_index)`.
2. **Canonical** (`src/storage/canonical/`) — deduplicated entities with stable UUID IDs. Created once per resolver version; alias tables redirect merged IDs.
3. **Identity link** (`src/storage/canonical/*IdentityLinkRepo`) — join table from `observation_id` + `resolver_version` → `canonical_*_id`. Written inline during extraction.
4. **Junction** (`src/storage/canonical/Canonical*AddressRepo`, `Canonical*PhoneRepo`) — co-occurrence tables associating canonical entities with addresses/phones at a given resolver version.

**`EntityObserver`** (`src/resolver/EntityObserver.ts`) — form storage modules call `observePerson()` / `observeCompany()` on this shared helper instead of writing person/company rows directly. It normalizes the claim, upserts the observation, calls the resolver, writes the identity link, and records address/phone junctions in one step.

**`PersonResolver` / `CompanyResolver`** (`src/resolver/`) — resolution algorithms. For persons: CIK fast-path, then normalized-name + issuer-CIK fallback. For companies: CIK → CRD → normalized-name cascade. Both create a fresh canonical row on first sight and delegate alias resolution to the alias repo.

**`VersionRegistry` and slot ceremonies** (`src/storage/versioning/`) — each extractor and resolver has three slots: `previous`, `current`, `next`. Ceremonies:
- `startDev` — opens a new dev cycle (populates `next`; patch bumps update `current` in place).
- `promote` — rotates `next → current → previous`. Major bumps enforce a coverage gate.
- `rollback` — swaps `previous` and `current`.
- `dropNext` — discards an in-flight cycle.
- `dropPrevious` — clears the previous slot and purges associated data (extractor runs or resolver identity-link/canonical rows).

### SQLite initialization

`src/sec.ts` invokes **`Sqlite.init()`** when the installed `workglow` package defines it (`typeof Sqlite.init === "function"`), so newer Workglow releases load the SQLite binding before `getDb()` opens a database. Older `workglow` versions without `init` skip this step.

**`getDb()` is SQLite-only.** It throws `SecCliConfigurationError` when `SEC_DB_TYPE !== "sqlite"` to prevent the silent data divergence that occurred before (`getDb()` would open a stray SQLite file even under Postgres, and rows written through it never reached the configured backend). Tasks that need a raw SQL fast path beyond what `ITabularStorage` exposes must branch on `SEC_DB_TYPE` themselves — see `src/storage/entity/cikNameBulkWriter.ts` for the pattern (SQLite → `getDb()`, Postgres → `getPgPool()`, otherwise → repository `putBulk` for tests).

### Dependency Injection

Uses the `workglow` package’s `globalServiceRegistry` with typed tokens. Production uses `SqliteTabularRepository`, tests use `InMemoryTabularRepository`. Call `resetDependencyInjectionsForTesting()` from `src/config/TestingDI.ts` in test setup.

### Schema Pattern

Schemas use TypeBox (v1, imported as `typebox`). Each storage module exports:

- A TypeBox schema (e.g., `AddressSchema`)
- Primary key name constants (e.g., `AddressPrimaryKeyNames`)
- A DI token (e.g., `ADDRESS_REPOSITORY_TOKEN`)
- A repo class with domain-specific save/query methods

### Environment Variables

Set in `.env.local` (see `.env.test` for test defaults):

- `SEC_RAW_DATA_FOLDER` — path to raw downloaded data
- `SEC_DB_FOLDER` — path to SQLite database directory
- `SEC_DB_NAME` — database name (default: `edgar`)
- `SEC_DB_TYPE` — `"sqlite"` (default) or `"postgres"`
- `SEC_PG_URL` — PostgreSQL connection string (takes precedence over individual PG vars)
- `SEC_PG_HOST` — PostgreSQL host (default: `localhost`)
- `SEC_PG_PORT` — PostgreSQL port (default: `5432`)
- `SEC_PG_USER` — PostgreSQL user
- `SEC_PG_PASSWORD` — PostgreSQL password
- `SEC_PG_DATABASE` — PostgreSQL database name (default: `edgar`)

## TypeScript Conventions

From `.cursor/rules/`:

- Use **Bun** runtime, not Node.js (`bun test`, `bun run`, etc.)
- **No default exports** (use named exports)
- **No enums** — use `as const` objects instead
- **`import type`** for type-only imports; merge when mixed with value imports
- **Interfaces over type intersections** (`interface extends` instead of `&`)
- **`readonly` properties** by default on object types
- **Explicit return types** on top-level module functions (except JSX components)
- **Optional properties sparingly** — prefer `string | undefined` over `?: string` to force explicit passing
- **Discriminated unions** for modeling variant data shapes
- Use `as any` only inside generic function bodies when TypeScript cannot narrow correctly
- Concise JSDoc only when behavior is non-obvious; use `@link` for cross-references

## Formatting

Prettier: 100 char print width, 2-space indent, double quotes, trailing commas (es5), semicolons.
