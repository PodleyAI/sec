/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { fetchS1Fixtures } from "./fetchS1Fixtures";
import { edgarS1Deps } from "./s1FixtureSource";

export type FetchS1FixturesTaskInput = {
  readonly count?: number;
  readonly minSpac?: number;
};

export type FetchS1FixturesTaskOutput = {
  readonly downloaded: number;
  readonly skipped: number;
  readonly spacs: number;
};

/**
 * Downloads a SPAC-floored random sample of real S-1 prospectus HTML into the
 * gitignored mock_data/s1/.cache directory for converter testing.
 */
export class FetchS1FixturesTask extends Task<FetchS1FixturesTaskInput, FetchS1FixturesTaskOutput> {
  static readonly type = "FetchS1FixturesTask";
  static readonly category = "SEC";
  static readonly title = "Fetch S-1 fixtures";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      count: Type.Optional(Type.Number()),
      minSpac: Type.Optional(Type.Number()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      downloaded: Type.Number(),
      skipped: Type.Number(),
      spacs: Type.Number(),
    });
  }

  async execute(input: FetchS1FixturesTaskInput): Promise<FetchS1FixturesTaskOutput> {
    const result = await fetchS1Fixtures({
      count: input.count,
      minSpac: input.minSpac,
      deps: edgarS1Deps((msg) => console.log(msg)),
    });
    return {
      downloaded: result.downloaded,
      skipped: result.skipped,
      spacs: result.spacs,
    };
  }
}
