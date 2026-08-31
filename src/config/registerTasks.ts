/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "workglow";
import { ParseFilingDocumentTask } from "../task/forms/ParseFilingDocumentTask";
import { ListFormTypesTask } from "../task/query/ListFormTypesTask";
import { QueryCiksTask } from "../task/query/QueryCiksTask";
import { QueryCrowdfundingTask } from "../task/query/QueryCrowdfundingTask";
import { QueryEntitiesTask } from "../task/query/QueryEntitiesTask";
import { QueryFactsTask } from "../task/query/QueryFactsTask";
import { QueryFilingsTask } from "../task/query/QueryFilingsTask";
import { QueryOfferingsTask } from "../task/query/QueryOfferingsTask";
import { QueryPersonsTask } from "../task/query/QueryPersonsTask";
import { QueryRegASummaryTask } from "../task/query/QueryRegASummaryTask";
import { QueryRegATask } from "../task/query/QueryRegATask";
import { QueryXbrlTask } from "../task/query/QueryXbrlTask";

/**
 * The sec tasks worth offering as standalone `task run` targets.
 *
 * Deliberately a curated list rather than every class under `src/task/`. Most
 * of those are pipeline steps — bulk writers, version ceremonies, per-filing
 * store handlers — that mean nothing invoked alone and would bury the readable
 * entries in a `task list` of a hundred rows. These read the database and
 * answer a question, which is what a task runner is for.
 *
 * {@link ParseFilingDocumentTask} is here for a narrower reason: it is the only
 * way to see what a parser makes of a filing when nothing in this deployment
 * extracts that form, and whoever is working on such a parser has to be able to
 * reach it. It writes nothing and fetches nothing, so being reachable costs
 * nothing either.
 */
export const SEC_CLI_TASKS = [
  ListFormTypesTask,
  ParseFilingDocumentTask,
  QueryCiksTask,
  QueryCrowdfundingTask,
  QueryEntitiesTask,
  QueryFactsTask,
  QueryFilingsTask,
  QueryOfferingsTask,
  QueryPersonsTask,
  QueryRegASummaryTask,
  QueryRegATask,
  QueryXbrlTask,
] as const;

/**
 * Registers sec's tasks into the global {@link TaskRegistry}, which is what
 * `task list` / `task run` and the web console enumerate. Idempotent.
 */
export function registerSecTasks(): void {
  for (const task of SEC_CLI_TASKS) {
    TaskRegistry.registerTask(task);
  }
}
