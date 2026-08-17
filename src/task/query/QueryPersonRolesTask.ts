/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { TaskPorts } from "../taskPorts";
import type { QueryResult } from "../../cli/queries/EntityQuery";
import { queryPersonRoles, type PersonRoleRow } from "../../cli/queries/RoleQuery";
import { queryResultSchema } from "./queryResultSchema";

export type QueryPersonRolesTaskInput = {
  readonly cik: number;
  readonly current?: boolean;
  readonly limit?: number;
  readonly offset?: number;
};

/** Lists dated person↔title tenures at a company. */
export class QueryPersonRolesTask extends Task<
  QueryPersonRolesTaskInput,
  TaskPorts<QueryResult<PersonRoleRow>>
> {
  static readonly type = "QueryPersonRolesTask";
  static readonly category = "SEC";
  static readonly title = "Query person roles";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: Type.Number(),
      current: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Number()),
      offset: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return queryResultSchema();
  }

  async execute(input: QueryPersonRolesTaskInput): Promise<TaskPorts<QueryResult<PersonRoleRow>>> {
    return queryPersonRoles(input);
  }
}
