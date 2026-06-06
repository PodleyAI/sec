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
eligible. Configure the model via `SEC_S1_MODEL` (default `claude-sonnet-4-6`)
and an optional confidence floor via `SEC_S1_CONFIDENCE_FLOOR`.

A curated sample of real S-1 prospectus HTML (incl. ≥3 SPACs, SIC 6770) is
committed under `src/sec/html/mock_data/s1/` (see its `SOURCES.md`) and exercised
by `parseEdgarHtml.golden.test.ts`. To refresh / grow the sample on demand into a
gitignored cache:

```bash
sec fetch s1-fixtures                 # ~10 real S-1s (>= 3 SPACs) -> mock_data/s1/.cache/
sec fetch s1-fixtures -c 20 --min-spac 5
```

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
sec canonical underwriter-family alias-list

# Versioning for the new resolver kind
sec version coverage resolver underwriter-family
sec version drop-previous resolver underwriter-family

# Point-in-time ticker series for an issuer
sec issuer tickers <cik>
```

## Architecture

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
