/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { queryCiks, type CikQueryResult } from "../../cli/queries/CikQuery";
import type { TaskPorts } from "../taskPorts";
import { queryResultSchema } from "./queryResultSchema";

export type QueryCiksTaskInput = {
  readonly name: string;
  readonly exact?: boolean;
  readonly limit?: number;
  readonly offset?: number;
};

/** Finds CIK numbers by company name in the local `cik_names` table. */
export class QueryCiksTask extends Task<QueryCiksTaskInput, TaskPorts<CikQueryResult>> {
  static readonly type = "QueryCiksTask";
  static readonly category = "SEC";
  static readonly title = "Query CIK names";
  static readonly description =
    "Looks up filers by name from the CIK-to-name index, exact or substring";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      name: Type.String(),
      exact: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Number()),
      offset: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return queryResultSchema({ tableEmpty: Type.Boolean() });
  }

  async execute(input: QueryCiksTaskInput): Promise<TaskPorts<CikQueryResult>> {
    return queryCiks(input);
  }
}
