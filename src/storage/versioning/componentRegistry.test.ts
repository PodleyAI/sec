/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { isRegisteredComponent, listRegisteredComponents } from "./componentRegistry";

describe("componentRegistry", () => {
  it("registers all extractors", () => {
    for (const id of [
      "D",
      "C",
      "CFPORTAL",
      "1-A",
      "1-K",
      "1-Z",
      "3",
      "4",
      "5",
      "144",
      "S-1",
      "424",
      "8-K",
    ]) {
      expect(isRegisteredComponent("extractor", id)).toBe(true);
    }
  });

  it("registers person, company, sponsor-family, and underwriter-family resolvers", () => {
    expect(isRegisteredComponent("resolver", "person")).toBe(true);
    expect(isRegisteredComponent("resolver", "company")).toBe(true);
    expect(isRegisteredComponent("resolver", "sponsor-family")).toBe(true);
    expect(isRegisteredComponent("resolver", "underwriter-family")).toBe(true);
  });

  it("rejects unknown ids", () => {
    expect(isRegisteredComponent("extractor", "X")).toBe(false);
    expect(isRegisteredComponent("resolver", "sponsor")).toBe(false);
  });

  it("listRegisteredComponents returns one entry per extractor and resolver", () => {
    // 15 extractors + 4 resolvers (person, company, sponsor-family, underwriter-family).
    expect(listRegisteredComponents()).toHaveLength(19);
  });
});
