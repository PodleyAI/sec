/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { collectMappedResults } from "./evalS1Run";

describe("collectMappedResults", () => {
  it("flats one workflow-wrapped array of per-iteration arrays", () => {
    expect(collectMappedResults<number>({ results: [[1, 2], [3]] })).toEqual([1, 2, 3]);
  });

  it("accepts an already-flat results array", () => {
    expect(collectMappedResults<number>({ results: [1, 2] })).toEqual([1, 2]);
  });

  it("returns [] when results is missing", () => {
    expect(collectMappedResults({})).toEqual([]);
  });
});
