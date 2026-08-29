/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { isNewerTrustSnapshot } from "./trustSnapshot";

describe("isNewerTrustSnapshot", () => {
  it("applies when the row has no current trust yet", () => {
    expect(
      isNewerTrustSnapshot({ asOf: "2024-03-31", filed: "2024-05-15" }, { asOf: null, filed: null })
    ).toBe(true);
  });

  it("applies a later quarter and rejects an older one", () => {
    const existing = { asOf: "2024-03-31", filed: "2024-05-15" };
    expect(isNewerTrustSnapshot({ asOf: "2024-06-30", filed: "2024-08-14" }, existing)).toBe(true);
    expect(isNewerTrustSnapshot({ asOf: "2023-12-31", filed: "2024-03-01" }, existing)).toBe(false);
  });

  it("applies a same-period restatement filed later", () => {
    const existing = { asOf: "2024-03-31", filed: "2024-05-15" };
    expect(isNewerTrustSnapshot({ asOf: "2024-03-31", filed: "2024-06-01" }, existing)).toBe(true);
    expect(isNewerTrustSnapshot({ asOf: "2024-03-31", filed: "2024-05-15" }, existing)).toBe(false);
    expect(isNewerTrustSnapshot({ asOf: "2024-03-31", filed: "2024-05-01" }, existing)).toBe(false);
  });
});
