/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { stripGenerationTags } from "./patchHftChatTemplate";

describe("stripGenerationTags", () => {
  it("removes whitespace-controlled LFM2.5-style markers", () => {
    const t = "A{%- generation -%}B{%- endgeneration -%}C";
    expect(stripGenerationTags(t)).toBe("ABC");
  });

  it("removes plain (non-dashed) markers", () => {
    expect(stripGenerationTags("X{% generation %}Y{% endgeneration %}Z")).toBe("XYZ");
  });

  it("leaves `add_generation_prompt` and other statements intact", () => {
    const t = "{%- if add_generation_prompt -%}<|assistant|>{%- endif -%}";
    expect(stripGenerationTags(t)).toBe(t);
  });

  it("is a no-op for templates without the markers", () => {
    const t = "{% for m in messages %}{{ m.content }}{% endfor %}";
    expect(stripGenerationTags(t)).toBe(t);
  });
});
