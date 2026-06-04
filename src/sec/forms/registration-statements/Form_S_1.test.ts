/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { Form_S_1 } from "./Form_S_1";

describe("Form_S_1.parse", () => {
  it("returns the html body and a null-filled header when input has no DOCUMENT envelope", async () => {
    const html = "<html><body><h1>PROSPECTUS</h1></body></html>";
    const parsed = await Form_S_1.parse("S-1", html);
    expect(parsed.html).toBe(html);
    expect(parsed.header.cik).toBeNull();
    expect(parsed.header.sic).toBeNull();
    expect(parsed.header.companyName).toBeNull();
    expect(parsed.header.filingDate).toBeNull();
  });
});
