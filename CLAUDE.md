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

## Architecture

### Layered Structure

- **`src/commands/`** — Commander CLI command definitions. Each command wires up tasks and invokes them.
- **`src/task/`** — Workglow task graph tasks (fetch, store, process). Organized by domain: `ciknames/`, `facts/`, `forms/`, `index/`, `submissions/`.
- **`src/sec/`** — SEC data parsing and schemas. `forms/` has subdirectories per form category (e.g., `exempt-offerings/`). Each form type has a parser (`.ts`), a TypeBox schema (`.schema.ts`), and optional storage logic (`.storage.ts`). `submissions/` and `indexes/` handle their respective data types.
- **`src/storage/`** — Repository pattern persistence layer. Each domain (entity, filing, address, company, person, phone, investment-offering, portal) has schemas, repos, and normalization logic. Uses junction tables for many-to-many relationships. All entities are linked via CIK (Central Index Key).
- **`src/fetch/`** — SEC-specific fetch tasks with caching and job queue integration.
- **`src/config/`** — Dependency injection setup. `tokens.ts` defines DI tokens, `EnvToDI.ts` reads env vars, `DefaultDI.ts` registers SQLite-backed repos, `TestingDI.ts` registers in-memory repos.
- **`src/types/edgar/`** — TypeScript types for raw EDGAR API responses.
- **`src/util/`** — Database helpers (`db.ts` manages SQLite connection and prepared statement caching).

### SQLite initialization

`src/sec.ts` invokes **`Sqlite.init()`** when the installed `workglow` package defines it (`typeof Sqlite.init === "function"`), so newer Workglow releases load the SQLite binding before `getDb()` opens a database. Older `workglow` versions without `init` skip this step.

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
