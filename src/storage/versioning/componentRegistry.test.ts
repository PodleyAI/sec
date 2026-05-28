/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { isRegisteredComponent, listRegisteredComponents } from "./componentRegistry";

describe("componentRegistry", () => {
  it("registers all extractors", () => {
    for (const id of ["D", "C", "1-A", "1-K", "1-Z", "3", "4", "5", "144"]) {
      expect(isRegisteredComponent("extractor", id)).toBe(true);
    }
  });

  it("registers person and company resolvers", () => {
    expect(isRegisteredComponent("resolver", "person")).toBe(true);
    expect(isRegisteredComponent("resolver", "company")).toBe(true);
  });

  it("rejects unknown ids", () => {
    expect(isRegisteredComponent("extractor", "X")).toBe(false);
    expect(isRegisteredComponent("resolver", "sponsor")).toBe(false);
  });

  it("listRegisteredComponents returns one entry per extractor and resolver", () => {
    expect(listRegisteredComponents()).toHaveLength(11);
  });
});
