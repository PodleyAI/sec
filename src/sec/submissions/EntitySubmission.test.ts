/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { objectOfArraysAsArrayOfObjects } from "workglow";
// @ts-ignore
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import submissions1017389 from "./mock_data/submissions_1017389.json" with { type: "json" };

type Submissions = typeof submissions1017389;

describe("SEC Submissions", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("should iterate over the submissions", async () => {
    // calc the fastest way, iterating over the underlying array
    let totalArray = submissions1017389.filings.recent.size.reduce((acc, curr) => acc + curr, 0);

    // calc via the proxy to ensure we get the same result
    const submissions = objectOfArraysAsArrayOfObjects(submissions1017389.filings.recent);
    let totalIterator = 0;
    for (const submission of submissions) {
      totalIterator += submission.size;
    }

    // calc via the cursor (less memory thrashing) to ensure we get the same result
    let totalCursor = 0;
    for (const submission of submissions.cursor()) {
      totalCursor += submission.size;
    }

    expect(totalArray).toEqual(totalIterator);
    expect(totalArray).toEqual(totalCursor);
    expect(totalArray).toEqual(125957);
  });
});
