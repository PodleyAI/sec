/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { TaskPorts } from "../taskPorts";
import type { QueryResult } from "../../cli/queries/EntityQuery";
import { queryRegAOfferings } from "../../cli/queries/RegAQuery";
import type { RegAOffering } from "../../storage/reg-a/RegAOfferingSchema";
import { queryResultSchema } from "./queryResultSchema";

export type QueryRegATaskInput = {
  readonly search?: string;
  readonly cik?: number;
  readonly tier?: string;
  readonly status?: string;
  readonly jurisdiction?: string;
  readonly limit?: number;
  readonly offset?: number;
};

/** Searches Regulation A offerings (Form 1-A / 1-K / 1-Z data). */
export class QueryRegATask extends Task<QueryRegATaskInput, TaskPorts<QueryResult<RegAOffering>>> {
  static readonly type = "QueryRegATask";
  static readonly category = "SEC";
  static readonly title = "Query Reg A offerings";
  static readonly description =
    "Queries stored Reg A offerings by issuer, tier, status, or jurisdiction";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      search: Type.Optional(Type.String()),
      cik: Type.Optional(Type.Number()),
      tier: Type.Optional(Type.String()),
      status: Type.Optional(Type.String()),
      jurisdiction: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      offset: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return queryResultSchema();
  }

  async execute(input: QueryRegATaskInput): Promise<TaskPorts<QueryResult<RegAOffering>>> {
    return queryRegAOfferings(input);
  }
}
