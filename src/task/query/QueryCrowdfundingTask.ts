/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { TaskPorts } from "../taskPorts";
import { queryCrowdfunding } from "../../cli/queries/CrowdfundingQuery";
import type { QueryResult } from "../../cli/queries/EntityQuery";
import type { Crowdfunding } from "../../storage/portal/CrowdfundingSchema";
import { queryResultSchema } from "./queryResultSchema";

export type QueryCrowdfundingTaskInput = {
  readonly search?: string;
  readonly cik?: number;
  readonly portal?: number;
  readonly after?: string;
  readonly before?: string;
  readonly limit?: number;
  readonly offset?: number;
};

/** Searches crowdfunding offerings in the local database. */
export class QueryCrowdfundingTask extends Task<
  QueryCrowdfundingTaskInput,
  TaskPorts<QueryResult<Crowdfunding>>
> {
  static readonly type = "QueryCrowdfundingTask";
  static readonly category = "SEC";
  static readonly title = "Query crowdfunding offerings";
  static readonly description =
    "Queries stored Reg CF offerings by issuer, funding portal, or filing date";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      search: Type.Optional(Type.String()),
      cik: Type.Optional(Type.Number()),
      portal: Type.Optional(Type.Number()),
      after: Type.Optional(Type.String()),
      before: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      offset: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return queryResultSchema();
  }

  async execute(input: QueryCrowdfundingTaskInput): Promise<TaskPorts<QueryResult<Crowdfunding>>> {
    return queryCrowdfunding(input);
  }
}
