/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { ALL_FORMS_MAP, isFormParsingSupported } from "./all-forms";
import { FORM_TO_EXTRACTOR_ID } from "../../storage/versioning/extractorIds";
import { Form_1_A } from "./exempt-offerings/Form_1_A";

describe("form wiring", () => {
  it("registers 1-A POS to the parsing Form_1_A class (not a stub)", () => {
    expect(ALL_FORMS_MAP.get("1-A POS")).toBe(Form_1_A as any);
    expect(isFormParsingSupported("1-A POS")).toBe(true);
  });

  it("maps 1-A POS to the 1-A extractor", () => {
    expect(FORM_TO_EXTRACTOR_ID["1-A POS"]).toBe("1-A");
  });

  it("every extractor-mapped form has a real parser override", () => {
    for (const form of Object.keys(FORM_TO_EXTRACTOR_ID)) {
      expect({ form, supported: isFormParsingSupported(form) }).toEqual({
        form,
        supported: true,
      });
    }
  });
});
