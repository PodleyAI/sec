/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { RESOLVER_IDS } from "./resolverIds";

describe("resolverIds", () => {
  it("contains person, company, sponsor-family, and underwriter-family", () => {
    expect(RESOLVER_IDS).toEqual(["person", "company", "sponsor-family", "underwriter-family"]);
  });
});
