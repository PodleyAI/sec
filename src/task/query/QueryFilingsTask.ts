/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { TaskPorts } from "../taskPorts";
import type { QueryResult } from "../../cli/queries/EntityQuery";
import { queryFilings } from "../../cli/queries/FilingQuery";
import type { Filing } from "../../storage/filing/FilingSchema";
import { queryResultSchema } from "./queryResultSchema";

export type QueryFilingsTaskInput = {
  readonly search?: string;
  readonly cik?: number;
  readonly form?: string;
  readonly after?: string;
  readonly before?: string;
  readonly limit?: number;
  readonly offset?: number;
};

/** Searches filings in the local database. */
export class QueryFilingsTask extends Task<QueryFilingsTaskInput, TaskPorts<QueryResult<Filing>>> {
  static readonly type = "QueryFilingsTask";
  static readonly category = "SEC";
  static readonly title = "Query filings";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      search: Type.Optional(Type.String()),
      cik: Type.Optional(Type.Number()),
      form: Type.Optional(Type.String()),
      after: Type.Optional(Type.String()),
      before: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      offset: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return queryResultSchema();
  }

  async execute(input: QueryFilingsTaskInput): Promise<TaskPorts<QueryResult<Filing>>> {
    return queryFilings(input);
  }
}
