/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { allRegisteredForms, formHasExtractor } from "./formExtractors";
import {
  ALL_FORM_NAMES,
  ALL_FORMS_MAP,
  ALL_FORMS_MAP_ARRAY,
  isFormParsingSupported,
} from "./all-forms";
import { Form_1_A } from "./exempt-offerings/Form_1_A";

// Both directions below read the form-extractor registry, which is empty until
// something registers into it.
registerSecFormExtractors();

// Pre-existing stub-vs-stub duplicate registrations (both classes lack a
// parse() override, so the shadowing is currently harmless). Resolving them
// means deciding which class owns the code — until then they are pinned so
// any NEW duplicate fails this suite.
const KNOWN_DUPLICATE_FORM_CODES = new Set(["AW WD", "PREM14A", "PREC14A"]);

/**
 * Forms this package catalogues but deliberately ships no extractor for,
 * because reading them is a scan of human-authored prose or tables that lives
 * in a downstream package instead.
 *
 * They still need a class here, and that class still needs a parse that
 * returns rather than throws: `ProcessAccessionDocFormTask` resolves the form's
 * class and runs its parse BEFORE any registered extractor, and does so
 * uncontained — a form absent from `ALL_FORMS_MAP` throws out of the sweep
 * rather than dead-lettering one filing. So the entry is what lets a
 * downstream extractor reach the filing at all, and the parse yields an empty
 * object because sec has nothing of its own to read.
 *
 * Pinned by name so a form that loses its extractor by accident still fails
 * this suite.
 */
const FORMS_LEFT_TO_A_DOWNSTREAM_EXTRACTOR = new Set(["1-SA", "1-SA/A"]);

describe("form wiring", () => {
  it("registers 1-A POS to the parsing Form_1_A class (not a stub)", () => {
    expect(ALL_FORMS_MAP.get("1-A POS")).toBe(Form_1_A as any);
  });

  it("every form an extractor is registered for has a real parser override", () => {
    for (const form of allRegisteredForms()) {
      expect({ form, supported: isFormParsingSupported(form) }).toEqual({
        form,
        supported: true,
      });
    }
  });

  it("every parse-supported form has a registered extractor", () => {
    // The other half of the 1-A POS incident: a parser the CLI advertises
    // (`parse: yes`) whose dispatch then throws "No extractor registered".
    for (const form of ALL_FORM_NAMES) {
      if (!isFormParsingSupported(form)) continue;
      if (FORMS_LEFT_TO_A_DOWNSTREAM_EXTRACTOR.has(form)) continue;
      expect({ form, mapped: formHasExtractor(form) }).toEqual({
        form,
        mapped: true,
      });
    }
  });

  it("no form code is silently shadowed by a duplicate registration", () => {
    // new Map() keeps the LAST entry per key, which is how the Form_1_A_POS
    // stub hid the real 1-A POS parser. Every duplicate must be pinned above.
    const seen = new Map<string, unknown>();
    const unexpected: string[] = [];
    for (const [form, cls] of ALL_FORMS_MAP_ARRAY) {
      const prev = seen.get(form);
      if (prev !== undefined && prev !== cls && !KNOWN_DUPLICATE_FORM_CODES.has(form)) {
        unexpected.push(form);
      }
      seen.set(form, cls);
    }
    expect(unexpected).toEqual([]);
  });
});
