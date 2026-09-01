/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  clearFormExtractorsForTesting,
  extractorReadsFullSubmission,
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
import { submissionFetchKind } from "../task/forms/submissionFetchPolicy";
import { registerSecFormExtractors } from "./registerFormExtractors";

beforeEach(() => {
  clearFormExtractorsForTesting();
  registerSecFormExtractors();
});
afterEach(() => clearFormExtractorsForTesting());

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
  for (const form of ["253G1", "1-A-W", "1-U"]) {
    expect(formNeedsDocument(form), `form ${form}`).toBe(false);
  }
  for (const form of ["D", "S-1", "8-K", "1-K"]) {
    expect(formNeedsDocument(form), `form ${form}`).toBe(true);
  }
  // `25` and `RW` were metadata-only extractors here until the lifecycle
  // reading that turns them into an event moved to a consumer package. They
  // route to nothing now, and a form with no registered extractor answers
  // `true` — the conservative default, which the dispatcher never acts on
  // because it skips such a filing whole before fetching anything.
  for (const form of ["25", "RW"]) {
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
  // The 8-K is in neither set and no extractor declares it: every 8-K is
  // fetched whole by form policy alone, which is what lets both halves of its
  // split be handed the same cached file without either restating the
  // decision. Both downloaders already lay its `.txt` down by branching on the
  // form symbol itself — `BootstrapAccessionDocsTask.writeFiling`'s
  // `isEightK`, and `spacDocFetchKind`.
  const declared = listFormExtractorKeys()
    .map((key) => getFormExtractor(key))
    .filter((ext) => ext?.needsFullSubmission === true)
    .flatMap((ext) => [...(ext?.forms ?? [])]);
  const cached = [...REGISTRATION_PROSPECTUS_FORMS, ...REGA_FULL_SUBMISSION_FORMS];
  expect([...new Set(declared)].sort()).toEqual([...new Set(cached)].sort());
  for (const form of ["8-K", "8-K/A"]) {
    expect(declared, `form ${form}`).not.toContain(form);
    expect(submissionFetchKind(form), `form ${form}`).toBe("full-submission");
  }
});

test("8-K is fetched whole for every filing; the item-code half reads none of it", async () => {
  // The two axes answer different questions about the same 8-K: which file to
  // download (always the whole submission, so the exhibits are cached with it)
  // and what an extractor is handed to read. The half that stays here reads
  // the submissions metadata and the shared parse — never an exhibit, never a
  // narrative — so it declares no `readsFullSubmission` at all, and the
  // dispatcher stamps `extractor_runs.read_full_submission` false for it on
  // every filing however the body was fetched. The milestone reading that DOES
  // open the body registers `8-K` elsewhere and states its own predicate;
  // `readsFullSubmission` is never unioned across a form's extractors, so this
  // one cannot inherit it.
  for (const form of ["8-K", "8-K/A"]) {
    expect(submissionFetchKind(form), `form ${form}`).toBe("full-submission");
  }
  const ext = getFormExtractor("8-K-items");
  expect(ext).toBeDefined();
  expect(ext?.needsFullSubmission).toBeUndefined();
  expect(ext?.readsFullSubmission).toBeUndefined();
  expect(
    await extractorReadsFullSubmission(ext!, { form: "8-K", cik: 1, items: "1.01,5.07" })
  ).toBe(false);
});
