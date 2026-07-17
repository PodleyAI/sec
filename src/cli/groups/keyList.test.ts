/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { keyListForTesting } from "./eval";

describe("keyList", () => {
  it("quotes each key so a comma inside a name cannot read as a separator", () => {
    // Two owners, not one name — the distinction these diffs exist to show.
    expect(keyListForTesting(["V-Cube, Inc.", "Naoaki Mashita"])).toBe(
      '"V-Cube, Inc.", "Naoaki Mashita"'
    );
    // ...and one combined name stays visibly one entry.
    expect(keyListForTesting(["V-Cube, Inc. and Naoaki Mashita"])).toBe(
      '"V-Cube, Inc. and Naoaki Mashita"'
    );
  });

  it("caps the list and reports the remainder", () => {
    const keys = Array.from({ length: 10 }, (_, i) => `n${i}`);
    expect(keyListForTesting(keys, 3)).toBe('"n0", "n1", "n2" (+7 more)');
  });
});
