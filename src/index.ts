/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Public library surface for `@workglow/sec`.
//
// This barrel IS the package's entry point (package.json `exports["."]` maps to
// the built `dist/index.js`). The `sec` CLI (src/sec.ts) is one consumer of this
// surface; downstream packages that build a *superset* CLI (e.g. `embarc-data`)
// import from here to reuse every SEC command, plus the DI/config, job queue,
// and teardown wiring the CLI relies on.
//
// Everything a superset builds on is re-exported by name below — add to this
// file when a new symbol needs to be public.

// ── CLI construction ────────────────────────────────────────────────────────
// `AddCommands(program)` registers every SEC command *and* installs the
// commander preAction hook that bootstraps DI (EnvToDI/DefaultDI), models,
// providers, and starts the fetch job queue. A superset CLI keeps calling this
// (then adds its own commands) so that bootstrap still fires.
export {
  applyGlobalOptions,
  parseGlobalOptions,
  parseIntOption,
  type GlobalOptions,
} from "./cli/GlobalOptions";
export { isDryRun } from "./cli/isDryRun";
export { isJsonOutput } from "./cli/isJsonOutput";
export * from "./cli/output";
export { runCommand } from "./cli/runCommand";
export { runWorkflowCli } from "./cli/runWorkflow";
export { AddCommands } from "./commands";

// ── Config / dependency injection ───────────────────────────────────────────
export * from "./config/Constants";
export { createStorage } from "./config/createStorage";
export { DefaultDI } from "./config/DefaultDI";
export { EnvToDI, SecCliConfigurationError } from "./config/EnvToDI";
export { registerSecModels } from "./config/registerModels";
export { registerSecProviders } from "./config/registerProviders";
export * from "./config/tokens";

// ── Fetch job queue + fetch task bases ──────────────────────────────────────
export {
  SecCachedFetchTask,
  type SecCachedFetchTaskInput,
  type response_type,
} from "./task/fetch/SecCachedFetchTask";
export { SecFetchTask } from "./task/fetch/SecFetchTask";
export { SecJobQueueClient, SecJobQueueServer, SecJobQueueStorage } from "./task/fetch/SecJobQueue";

// ── Lifecycle / teardown ────────────────────────────────────────────────────
// A superset CLI must run these in its own shutdown path (mirroring src/sec.ts)
// or the process hangs on live DB handles and model worker threads.
export { closeDb, getDb } from "./util/db";
export { closePgPool, getPgPool } from "./util/pg";
export { terminateWorkers } from "./util/workers";

// ── Re-exported workglow primitives a superset commonly needs ────────────────
// Saves supersets from taking a direct `workglow` dependency just to stop the
// shared task-queue registry during shutdown.
export { getTaskQueueRegistry } from "workglow";
