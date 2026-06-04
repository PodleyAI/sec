/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { Form_S_1 } from "./Form_S_1";

describe("Form_S_1.parse", () => {
  it("returns the raw html as a passthrough payload", async () => {
    const html = "<html><body><h1>PROSPECTUS</h1></body></html>";
    const parsed = await Form_S_1.parse("S-1", html);
    expect(parsed).toEqual({ html });
  });
});
