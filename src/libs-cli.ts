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
import { commandNeedsSecRuntime } from "./config/cliRuntimeGate";
// Through the barrel, like `sec.ts`: it is what pins every consumer to one
// `workglow` instance, so the DI container this boots is the one the tasks read.
import {
  bootstrapSecRuntime,
  closeDb,
  closePgPool,
  getTaskQueueRegistry,
  registerSecTasks,
  terminateWorkers,
} from "./index";

await runWorkglowCli({
  name: "sec-base",
  description: "Workglow CLI carrying @workglow/sec's tasks",
  // Registration alone touches no DI — it only puts the classes in the
  // registry, so `task list` works with nothing configured.
  registerTasks: () => registerSecTasks(),
  registerCommands: (program) => {
    program.hook("preAction", async (_thisCommand, actionCommand) => {
      if (commandNeedsSecRuntime(actionCommand)) await bootstrapSecRuntime();
    });
  },
  exitOnComplete: false,
});

// Mirror the `sec` CLI's shutdown: allSettled so a crashing step cannot mask
// another or skip it. runWorkglowCli is told not to exit so this can run.
const cleanups = await Promise.allSettled([
  getTaskQueueRegistry().stopQueues(),
  Promise.resolve().then(() => closeDb()),
  closePgPool(),
  terminateWorkers(),
]);
for (const result of cleanups) {
  if (result.status === "rejected") console.error("Cleanup error:", result.reason);
}
process.exit(0);
