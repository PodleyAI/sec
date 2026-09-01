/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { QueryResult } from "../../cli/queries/EntityQuery";
import { queryOfferings } from "../../cli/queries/OfferingQuery";
import type { InvestmentOffering } from "../../storage/investment-offering/InvestmentOfferingSchema";
import type { TaskPorts } from "../taskPorts";
import { queryResultSchema } from "./queryResultSchema";

export type QueryOfferingsTaskInput = {
  readonly search?: string;
  readonly cik?: number;
  readonly industry?: string;
  readonly exemption?: string;
  readonly after?: string;
  readonly before?: string;
  readonly limit?: number;
  readonly offset?: number;
};

export type QueryOfferingsTaskOutput = TaskPorts<QueryResult<InvestmentOffering>>;

/** Searches investment offerings in the local database. */
export class QueryOfferingsTask extends Task<QueryOfferingsTaskInput, QueryOfferingsTaskOutput> {
  static readonly type = "QueryOfferingsTask";
  static readonly category = "SEC";
  static readonly title = "Query offerings";
  static readonly description =
    "Queries stored Form D offerings by issuer, industry, or exemption claimed";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      search: Type.Optional(Type.String()),
      cik: Type.Optional(Type.Number()),
      industry: Type.Optional(Type.String()),
      exemption: Type.Optional(Type.String()),
      after: Type.Optional(Type.String()),
      before: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      offset: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return queryResultSchema();
  }

  async execute(input: QueryOfferingsTaskInput): Promise<QueryOfferingsTaskOutput> {
    return queryOfferings(input);
  }
}
