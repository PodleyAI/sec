/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { queryAdvisers } from "../../cli/queries/AdviserQuery";
import type { QueryResult } from "../../cli/queries/EntityQuery";
import type { AdvAdviser } from "../../storage/adv/AdvAdviserSchema";
import type { TaskPorts } from "../taskPorts";
import { queryResultSchema } from "./queryResultSchema";

export type QueryAdvisersTaskInput = {
  readonly search?: string;
  readonly crd?: string;
  readonly state?: string;
  readonly snapshot?: string;
  readonly minAum?: number;
  readonly limit?: number;
  readonly offset?: number;
};

/** Queries stored Form ADV advisers. */
export class QueryAdvisersTask extends Task<
  QueryAdvisersTaskInput,
  TaskPorts<QueryResult<AdvAdviser>>
> {
  static readonly type = "QueryAdvisersTask";
  static readonly category = "SEC";
  static readonly title = "Query investment advisers";
  static readonly description =
    "Queries stored Form ADV advisers by name, CRD, state, snapshot, or reported AUM";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      search: Type.Optional(Type.String()),
      crd: Type.Optional(Type.String()),
      state: Type.Optional(Type.String()),
      snapshot: Type.Optional(Type.String()),
      minAum: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number()),
      offset: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return queryResultSchema();
  }

  async execute(input: QueryAdvisersTaskInput): Promise<TaskPorts<QueryResult<AdvAdviser>>> {
    return queryAdvisers(input);
  }
}
