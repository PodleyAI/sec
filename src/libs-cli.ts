#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `sec-base` — the Workglow CLI, carrying sec's tasks.
 *
 * The `sec` binary is the data pipeline: named commands over EDGAR. This is the
 * other half of the same runtime — the generic Workglow surface (`task`,
 * `model`, `mcp`, `workflow`, `agent`, `credential`, `web`) with sec's own
 * tasks registered into the task registry, so `sec-base task run QueryFilings`
 * and the web console list them alongside the built-in ones.
 *
 * The body is `runWorkglowCli` from `@workglow/cli`, not a copy of it: the
 * boot sequence, the HuggingFace worker path and the command set stay owned by
 * that package.
 */
import { runWorkglowCli } from "@workglow/cli";
import {
  installCliSignalTeardown,
  shouldInstallCliSignalTeardown,
} from "./cli/installCliSignalTeardown";
import { shutdownCliResources } from "./cli/shutdownCliResources";
import { bootstrapSecRuntime } from "./config/bootstrapSecRuntime";
import { registerSecTasks } from "./config/registerTasks";
import { registerSecWebUi } from "./web/registerSecWebUi";

// The command's own failure, kept across the shutdown below. `sec.ts` does the
// same, and for the same two reasons: a `process.exit(0)` in the success path
// reports a failed command as a success — `sec-base task run` is scripted, and
// a caller that cannot see a non-zero status cannot see a failure at all — and
// a throw that escapes this block skips the cleanup entirely, leaving the fetch
// queue's workers running so the process never exits.
let primaryError: unknown;
try {
  await runWorkglowCli({
    name: "sec-base",
    description: "Workglow CLI carrying sec's tasks",
    // sec's tasks read the database and fetch through the rate-limited queue, so
    // the runtime comes up before any of them can be listed or run.
    registerTasks: async () => {
      await bootstrapSecRuntime();
      registerSecTasks();
      // The console's contributed UI. `task run` reads a task's input schema, and
      // every sec CIK port carries `format: "cik"` — so the pickers and the
      // operator rail apply here too, even though this binary carries none of
      // sec's own commands for the panels to attach to.
      registerSecWebUi();
    },
    registerCommands: (program) => {
      program.hook("preAction", (_thisCommand, actionCommand) => {
        if (!shouldInstallCliSignalTeardown(actionCommand.name())) return;
        installCliSignalTeardown({ close: shutdownCliResources });
      });
    },
    exitOnComplete: false,
  });
} catch (err) {
  primaryError = err;
  process.exitCode = 1;
} finally {
  // Mirror the `sec` CLI's shutdown: allSettled so a crashing step cannot mask
  // another or skip it. runWorkglowCli is told not to exit so this can run.
  await shutdownCliResources();
}

if (primaryError !== undefined) throw primaryError;
process.exit(process.exitCode ?? 0);
