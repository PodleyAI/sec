/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { queryEntities, type QueryResult } from "../../cli/queries/EntityQuery";
import type { Entity } from "../../storage/entity/EntitySchema";
import type { TaskPorts } from "../taskPorts";
import { queryResultSchema } from "./queryResultSchema";

export type QueryEntitiesTaskInput = {
  readonly search?: string;
  readonly cik?: number;
  readonly sic?: number;
  readonly state?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly sort?: string;
};

/** Searches entities in the local database. */
export class QueryEntitiesTask extends Task<
  QueryEntitiesTaskInput,
  TaskPorts<QueryResult<Entity>>
> {
  static readonly type = "QueryEntitiesTask";
  static readonly category = "SEC";
  static readonly title = "Query entities";
  static readonly description = "Queries stored EDGAR entities by name, CIK, SIC code, or state";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      search: Type.Optional(Type.String()),
      cik: Type.Optional(Type.Number()),
      sic: Type.Optional(Type.Number()),
      state: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      offset: Type.Optional(Type.Number()),
      sort: Type.Optional(Type.String()),
    });
  }

  public static outputSchema() {
    return queryResultSchema();
  }

  async execute(input: QueryEntitiesTaskInput): Promise<TaskPorts<QueryResult<Entity>>> {
    return queryEntities(input);
  }
}
