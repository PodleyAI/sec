/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { ExemptOfferingFormCode } from "../../sec/forms/exempt-offerings/form-slugs";
import { fetchFixtures } from "./fetchFixtures";

export type FetchFixturesTaskInput = {
  /** Validated exempt-offering form codes — the CLI parses/validates raw args. */
  readonly forms: ExemptOfferingFormCode[];
  readonly count?: number;
  /** Validated YYYYQn quarter strings. */
  readonly quarters?: string[];
  readonly listOnly?: boolean;
};

export type FetchFixturesTaskOutput = {
  readonly downloaded: number;
  readonly failed: number;
  readonly skipped: number;
};

/** Downloads real EDGAR filings into the exempt-offering mock_data fixture tree. */
export class FetchFixturesTask extends Task<FetchFixturesTaskInput, FetchFixturesTaskOutput> {
  static readonly type = "FetchFixturesTask";
  static readonly category = "SEC";
  static readonly title = "Fetch form fixtures";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      forms: Type.Array(Type.String()),
      count: Type.Optional(Type.Number()),
      quarters: Type.Optional(Type.Array(Type.String())),
      listOnly: Type.Optional(Type.Boolean()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      downloaded: Type.Number(),
      failed: Type.Number(),
      skipped: Type.Number(),
    });
  }

  async execute(input: FetchFixturesTaskInput): Promise<FetchFixturesTaskOutput> {
    const result = await fetchFixtures({
      forms: input.forms,
      count: input.count,
      quarters: input.quarters,
      listOnly: input.listOnly,
      log: (msg) => console.log(msg),
    });
    return {
      downloaded: result.downloaded,
      failed: result.failed,
      skipped: result.skipped,
    };
  }
}
