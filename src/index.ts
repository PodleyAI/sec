/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Public library surface for `@workglow/sec`.
//
// The `sec` CLI (src/sec.ts) is one consumer of this surface; downstream
// packages that build a *superset* CLI (e.g. `embarc-data`) import from here
// to reuse every SEC command, plus the DI/config, job queue, and teardown
// wiring the CLI relies on.
//
// This barrel exposes the common, collision-free surface. Every other module
// (individual tasks, storage schemas/repositories, resolvers, form parsers,
// low-level utils) stays reachable via wildcard subpath imports declared in
// package.json `exports`, e.g.:
//
//   import { SpacReportTask } from "@workglow/sec/task/spac/SpacReportTask";
//   import { SpacSchema } from "@workglow/sec/storage/spac/SpacSchema";
//   import { CompanyResolver } from "@workglow/sec/resolver/CompanyResolver";
//
// so a superset can build on "all tasks and schemas" without this file having
// to re-export several hundred symbols.

// ── CLI construction ────────────────────────────────────────────────────────
// `AddCommands(program)` registers every SEC command *and* installs the
// commander preAction hook that bootstraps DI (EnvToDI/DefaultDI), models,
// providers, and starts the fetch job queue. A superset CLI keeps calling this
// (then adds its own commands) so that bootstrap still fires.
export { AddCommands } from "./commands";
export {
  applyGlobalOptions,
  parseGlobalOptions,
  parseIntOption,
  type GlobalOptions,
} from "./cli/GlobalOptions";
export { runCommand } from "./cli/runCommand";
export { runWorkflowCli } from "./cli/runWorkflow";
export * from "./cli/output";

// ── Config / dependency injection ───────────────────────────────────────────
export * from "./config/tokens";
export * from "./config/Constants";
export { EnvToDI, SecCliConfigurationError } from "./config/EnvToDI";
export { DefaultDI } from "./config/DefaultDI";
export { createStorage } from "./config/createStorage";
export { registerSecModels } from "./config/registerModels";
export { registerSecProviders } from "./config/registerProviders";

// ── Fetch job queue + fetch task bases ──────────────────────────────────────
export {
  SecJobQueueClient,
  SecJobQueueServer,
  SecJobQueueStorage,
} from "./task/fetch/SecJobQueue";
export { SecFetchTask } from "./task/fetch/SecFetchTask";
export {
  SecCachedFetchTask,
  type SecCachedFetchTaskInput,
  type response_type,
} from "./task/fetch/SecCachedFetchTask";

// ── Lifecycle / teardown ────────────────────────────────────────────────────
// A superset CLI must run these in its own shutdown path (mirroring src/sec.ts)
// or the process hangs on live DB handles and model worker threads.
export { getDb, closeDb } from "./util/db";
export { getPgPool, closePgPool } from "./util/pg";
export { terminateWorkers } from "./util/workers";

// ── Re-exported workglow primitives a superset commonly needs ────────────────
// Saves supersets from taking a direct `workglow` dependency just to stop the
// shared task-queue registry during shutdown.
export { getTaskQueueRegistry } from "workglow";
