/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { isRegisteredComponent, listRegisteredComponents } from "./componentRegistry";

describe("componentRegistry", () => {
  it("registers all five extractors", () => {
    for (const id of ["D", "C", "1-A", "1-K", "1-Z"]) {
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

  it("listRegisteredComponents returns 7 entries", () => {
    expect(listRegisteredComponents()).toHaveLength(7);
  });
});
