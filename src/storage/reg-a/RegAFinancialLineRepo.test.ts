/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("RegAFinancialLineRepo source", () => {
  it("is a text file: no NUL bytes, so git can diff it", () => {
    // A NUL anywhere makes git treat the whole blob as binary — `git diff`
    // reports `Bin N -> N bytes` instead of lines, and grep/ripgrep skip the
    // file. Any printable separator is fine; the property is that none of them
    // is a control character.
    const buf = readFileSync(new URL("./RegAFinancialLineRepo.ts", import.meta.url));
    expect(buf.includes(0)).toBe(false);
  });
});
