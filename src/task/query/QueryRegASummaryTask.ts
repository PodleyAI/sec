/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { summarizeRegA } from "../../cli/queries/RegAQuery";

export type QueryRegASummaryTaskInput = {
  readonly cik?: number;
};

export type QueryRegASummaryTaskOutput = {
  readonly offeringCount: number;
  /** Counts keyed by offering status (plain object — JSON/port safe). */
  readonly byStatus: Record<string, number>;
  /** Counts keyed by tier (plain object — JSON/port safe). */
  readonly byTier: Record<string, number>;
  readonly latestAggregateOffering: number | null;
};

/**
 * Rolls up Regulation A offerings: counts by status/tier, plus the latest
 * aggregate offering amount when a CIK is given. The summary's Maps are
 * flattened to plain records so the result survives JSON port serialization.
 */
export class QueryRegASummaryTask extends Task<
  QueryRegASummaryTaskInput,
  QueryRegASummaryTaskOutput
> {
  static readonly type = "QueryRegASummaryTask";
  static readonly category = "SEC";
  static readonly title = "Summarize Reg A offerings";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      offeringCount: Type.Number(),
      byStatus: Type.Record(Type.String(), Type.Number()),
      byTier: Type.Record(Type.String(), Type.Number()),
      latestAggregateOffering: Type.Union([Type.Number(), Type.Null()]),
    });
  }

  async execute(input: QueryRegASummaryTaskInput): Promise<QueryRegASummaryTaskOutput> {
    const summary = await summarizeRegA(input.cik);
    return {
      offeringCount: summary.offeringCount,
      byStatus: Object.fromEntries(summary.byStatus),
      byTier: Object.fromEntries(summary.byTier),
      latestAggregateOffering: summary.latestAggregateOffering ?? null,
    };
  }
}
