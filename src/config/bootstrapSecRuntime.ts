/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getTaskQueueRegistry, Sqlite } from "workglow";
import { getSecJobQueue } from "../task/fetch/SecJobQueue";
import { DefaultDI } from "./DefaultDI";
import { EnvToDI } from "./EnvToDI";
import { registerSecModels } from "./registerModels";
import { registerSecProviders } from "./registerProviders";

/**
 * Brings up everything a sec task needs before it runs: the SQLite binding, the
 * DI container, models, providers, and the started fetch queue.
 *
 * The `sec` CLI reaches this through its `preAction` hook; a second entrypoint
 * that boots sec's runtime some other way would drift from it silently — the
 * failures are late and look like unrelated bugs (a task resolving no model, a
 * fetch with no rate limiter), so both callers share this one path.
 */
export async function bootstrapSecRuntime(): Promise<void> {
  // Load the SQLite native binding only when a database may be opened.
  const secDbType = process.env.SEC_DB_TYPE ?? "sqlite";
  if (secDbType === "sqlite" && typeof Sqlite.init === "function") {
    await Sqlite.init();
  }

  EnvToDI();
  DefaultDI();
  await registerSecModels();
  await registerSecProviders();

  // Built lazily (after DI/env) so the Postgres-backed shared rate limiter can
  // read the pool + SEC_DB_TYPE from the registry.
  const secJobQueue = await getSecJobQueue();
  getTaskQueueRegistry().registerQueue({
    server: secJobQueue.server,
    client: secJobQueue.client,
    storage: secJobQueue.storage,
  });
  // Must await: otherwise a fast command can finish and stopQueues() while
  // start() is still in fixupJobs(); stop() then completes before workers
  // start, and start() resumes and leaves workers running — the process never
  // exits (e.g. `sec db status`).
  await secJobQueue.server.start();
}
