/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { TaskPorts } from "../taskPorts";
import type { QueryResult } from "../../cli/queries/EntityQuery";
import { queryPersons, type PersonQueryRow } from "../../cli/queries/PersonQuery";
import { queryResultSchema } from "./queryResultSchema";

export type QueryPersonsTaskInput = {
  readonly search?: string;
  readonly cik?: number;
  readonly relationship?: string;
  readonly limit?: number;
  readonly offset?: number;
};

/** Searches person observations in the local database. */
export class QueryPersonsTask extends Task<
  QueryPersonsTaskInput,
  TaskPorts<QueryResult<PersonQueryRow>>
> {
  static readonly type = "QueryPersonsTask";
  static readonly category = "SEC";
  static readonly title = "Query persons";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      search: Type.Optional(Type.String()),
      cik: Type.Optional(Type.Number()),
      relationship: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      offset: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return queryResultSchema();
  }

  async execute(input: QueryPersonsTaskInput): Promise<TaskPorts<QueryResult<PersonQueryRow>>> {
    return queryPersons(input);
  }
}
