/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { TaskPorts } from "../taskPorts";
import type { QueryResult } from "../../cli/queries/EntityQuery";
import { queryFacts } from "../../cli/queries/FactsQuery";
import type { CompanyFact } from "../../storage/facts/CompanyFactsSchema";
import { queryResultSchema } from "./queryResultSchema";

export type QueryFactsTaskInput = {
  readonly cik: number;
  readonly name?: string;
  readonly taxonomy?: string;
  readonly year?: number;
  readonly limit?: number;
  readonly offset?: number;
};

/** Queries stored company facts for a CIK. */
export class QueryFactsTask extends Task<QueryFactsTaskInput, TaskPorts<QueryResult<CompanyFact>>> {
  static readonly type = "QueryFactsTask";
  static readonly category = "SEC";
  static readonly title = "Query company facts";
  static readonly description =
    "Queries stored XBRL company facts by CIK, concept name, taxonomy, or year";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: Type.Number(),
      name: Type.Optional(Type.String()),
      taxonomy: Type.Optional(Type.String()),
      year: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number()),
      offset: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return queryResultSchema();
  }

  async execute(input: QueryFactsTaskInput): Promise<TaskPorts<QueryResult<CompanyFact>>> {
    return queryFacts(input);
  }
}
