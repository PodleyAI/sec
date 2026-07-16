/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { TaskPorts } from "../taskPorts";
import type { QueryResult } from "../../cli/queries/EntityQuery";
import { queryXbrlFacts } from "../../cli/queries/XbrlQuery";
import type { XbrlFactRow } from "../../storage/xbrl/XbrlFactSchema";
import { queryResultSchema } from "./queryResultSchema";

export type QueryXbrlTaskInput = {
  readonly accession?: string;
  readonly cik?: number;
  readonly concept?: string;
  readonly numericOnly?: boolean;
  readonly limit?: number;
  readonly offset?: number;
};

/** XBRL facts for a filing, or a concept's series across an issuer's filings. */
export class QueryXbrlTask extends Task<QueryXbrlTaskInput, TaskPorts<QueryResult<XbrlFactRow>>> {
  static readonly type = "QueryXbrlTask";
  static readonly category = "SEC";
  static readonly title = "Query XBRL facts";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      accession: Type.Optional(Type.String()),
      cik: Type.Optional(Type.Number()),
      concept: Type.Optional(Type.String()),
      numericOnly: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Number()),
      offset: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return queryResultSchema();
  }

  async execute(input: QueryXbrlTaskInput): Promise<TaskPorts<QueryResult<XbrlFactRow>>> {
    return queryXbrlFacts(input);
  }
}
