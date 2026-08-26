/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  clearFormExtractorsForTesting,
  extractorsForForm,
  formNeedsFullSubmission,
} from "../sec/forms/formExtractors";
import { FORM_TO_EXTRACTOR_ID } from "../storage/versioning/extractorIds";
import { registerSecFormExtractors } from "./registerFormExtractors";

beforeEach(() => {
  clearFormExtractorsForTesting();
  registerSecFormExtractors();
});
afterEach(() => clearFormExtractorsForTesting());

test("every form in FORM_TO_EXTRACTOR_ID resolves to at least one extractor", () => {
  const unmapped = Object.keys(FORM_TO_EXTRACTOR_ID).filter(
    (form) => extractorsForForm(form).length === 0
  );
  expect(unmapped).toEqual([]);
});

test("a registered extractor's id matches the form's mapped extractor id", () => {
  for (const [form, id] of Object.entries(FORM_TO_EXTRACTOR_ID)) {
    const ids = extractorsForForm(form).map((e) => e.id);
    expect(ids, `form ${form}`).toContain(id);
  }
});

test("registration is idempotent", () => {
  const before = extractorsForForm("D").length;
  registerSecFormExtractors();
  expect(extractorsForForm("D")).toHaveLength(before);
});

test("the prospectus forms need the full submission, Form D does not", async () => {
  const probe = (form: string) => ({ form, cik: 1, items: null });
  for (const form of ["S-1", "S-1/A", "DRS", "F-1", "424B4"]) {
    expect(await formNeedsFullSubmission(probe(form)), `form ${form}`).toBe(true);
  }
  expect(await formNeedsFullSubmission(probe("1-K"))).toBe(true);
  expect(await formNeedsFullSubmission(probe("1-SA"))).toBe(false);
  expect(await formNeedsFullSubmission(probe("D"))).toBe(false);
});
