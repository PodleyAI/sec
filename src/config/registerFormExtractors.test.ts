/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  clearFormExtractorsForTesting,
  extractorsForForm,
  formNeedsDocument,
  formNeedsFullSubmission,
  getFormExtractor,
  listFormExtractorKeys,
  registerFormExtractor,
} from "../sec/forms/formExtractors";
import {
  REGA_FULL_SUBMISSION_FORMS,
  REGISTRATION_PROSPECTUS_FORMS,
} from "../task/forms/ProcessAccessionDocFormTask";
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

test("the metadata-only forms need no document; document forms do", () => {
  for (const form of ["253G1", "1-A-W", "1-U", "25", "RW"]) {
    expect(formNeedsDocument(form), `form ${form}`).toBe(false);
  }
  for (const form of ["D", "S-1", "8-K", "1-K"]) {
    expect(formNeedsDocument(form), `form ${form}`).toBe(true);
  }
});

test("re-registering does not clobber a later override", () => {
  registerSecFormExtractors();
  registerFormExtractor({ id: "D", forms: ["D", "D/A"], store: async () => {} });
  const override = getFormExtractor("D");
  registerSecFormExtractors();
  expect(getFormExtractor("D")).toBe(override);
});

test("the full-submission form sets match the extractors that declare it", () => {
  // The dispatch task asks the registry which body to fetch; the bulk
  // downloader and the SPAC candidate downloader ask these two sets when they
  // lay out the fetch cache. Adding a form to one side only makes the cached
  // file and the requested one disagree — a permanent cache miss and a network
  // fetch on every filing of that form, with nothing else failing.
  //
  // 8-K is named here rather than folded into either set. Both downloaders
  // already lay its `.txt` down by branching on the form symbol itself —
  // `BootstrapAccessionDocsTask.writeFiling`'s `isEightK`, and
  // `spacDocFetchKind` — and neither set describes an 8-K.
  const declared = listFormExtractorKeys()
    .map((key) => getFormExtractor(key))
    .filter((ext) => ext?.needsFullSubmission === true)
    .flatMap((ext) => [...(ext?.forms ?? [])]);
  const cached = [...REGISTRATION_PROSPECTUS_FORMS, ...REGA_FULL_SUBMISSION_FORMS, "8-K", "8-K/A"];
  expect([...new Set(declared)].sort()).toEqual([...new Set(cached)].sort());
});

test("8-K is fetched whole for every filing, read whole only for a known SPAC's trigger", () => {
  // The two axes answer different questions about the same 8-K: which file to
  // download (always the whole submission, so the exhibits are cached with it)
  // and what the extractor is handed to read (still only a known SPAC's
  // redemption / letter-of-intent filing, which is what the narrative passes
  // are calibrated against). Collapsing them back into one flag widens a model
  // input to buy a cache change.
  const ext = getFormExtractor("8-K");
  expect(ext?.needsFullSubmission).toBe(true);
  expect(typeof ext?.readsFullSubmission).toBe("function");
});
