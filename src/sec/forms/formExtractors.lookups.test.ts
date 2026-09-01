/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  allRegisteredExtractorIds,
  allRegisteredForms,
  clearFormExtractorsForTesting,
  extractorIdsForForm,
  extractorsForForm,
  formHandledByExtractor,
  formHasExtractor,
  listFormExtractorKeys,
  registerFormExtractor,
} from "./formExtractors";

const noopStore = async (): Promise<void> => {};

/** A form nothing in the fixture registers. */
const UNREGISTERED_FORM = "1-U";

/**
 * One registry holding the three shapes these lookups have to tell apart: a
 * form carrying two extractors with different ids, one extractor id registered
 * under two sections (two registry keys, one extractor), and a form nothing
 * handles at all.
 */
beforeEach(() => {
  clearFormExtractorsForTesting();
  registerFormExtractor({ id: "8-K", forms: ["8-K", "8-K/A"], store: noopStore });
  registerFormExtractor({ id: "spac-milestone", forms: ["8-K"], store: noopStore });
  registerFormExtractor({ id: "S-1", section: "management", forms: ["S-1"], store: noopStore });
  registerFormExtractor({ id: "S-1", section: "ownership", forms: ["S-1"], store: noopStore });
});

afterEach(() => clearFormExtractorsForTesting());

test("the fixture registers four keys over three extractor ids", () => {
  expect(listFormExtractorKeys()).toEqual([
    "8-K",
    "spac-milestone",
    "S-1:management",
    "S-1:ownership",
  ]);
});

test("extractorIdsForForm returns every extractor on the form, not just the first", () => {
  expect(extractorIdsForForm("8-K")).toEqual(["8-K", "spac-milestone"]);
});

test("extractorIdsForForm reports a two-section extractor as one id", () => {
  // Two registry keys, one extractor: the sections are what `extractorsForForm`
  // is for, and must not leak into an id list.
  expect(extractorsForForm("S-1")).toHaveLength(2);
  expect(extractorIdsForForm("S-1")).toEqual(["S-1"]);
});

test("extractorIdsForForm returns an empty array for an unregistered form", () => {
  const ids = extractorIdsForForm(UNREGISTERED_FORM);
  expect(ids).toEqual([]);
  expect(ids).toBeDefined();
  expect(Array.isArray(ids)).toBe(true);
});

test("formHasExtractor is true for both registered forms and false for the unregistered one", () => {
  expect(formHasExtractor("8-K")).toBe(true);
  expect(formHasExtractor("S-1")).toBe(true);
  expect(formHasExtractor(UNREGISTERED_FORM)).toBe(false);
});

test("formHandledByExtractor tests membership, not the form's first extractor", () => {
  expect(formHandledByExtractor("8-K", "8-K")).toBe(true);
  expect(formHandledByExtractor("8-K", "spac-milestone")).toBe(true);
  expect(formHandledByExtractor("8-K", "S-1")).toBe(false);
});

test("formHandledByExtractor takes an id, and a sectioned key is not one", () => {
  expect(formHandledByExtractor("S-1", "S-1")).toBe(true);
  expect(formHandledByExtractor("S-1", "S-1:management")).toBe(false);
  expect(formHandledByExtractor(UNREGISTERED_FORM, "S-1")).toBe(false);
});

test("allRegisteredExtractorIds returns ids, deduped across sections", () => {
  expect(allRegisteredExtractorIds()).toEqual(["8-K", "spac-milestone", "S-1"]);
});

test("allRegisteredExtractorIds is shorter than the key list it must not return", () => {
  expect(allRegisteredExtractorIds()).not.toContain("S-1:management");
  expect(allRegisteredExtractorIds()).toHaveLength(3);
  expect(listFormExtractorKeys()).toHaveLength(4);
});

test("allRegisteredForms is the de-duplicated union of every extractor's forms", () => {
  expect(allRegisteredForms()).toEqual(["8-K", "8-K/A", "S-1"]);
  expect(allRegisteredForms()).not.toContain(UNREGISTERED_FORM);
});

test("a later registration is visible to the id lookups", () => {
  expect(extractorIdsForForm(UNREGISTERED_FORM)).toEqual([]);
  registerFormExtractor({ id: "1-U", forms: [UNREGISTERED_FORM], store: noopStore });
  expect(extractorIdsForForm(UNREGISTERED_FORM)).toEqual(["1-U"]);
  expect(formHasExtractor(UNREGISTERED_FORM)).toBe(true);
  expect(formHandledByExtractor(UNREGISTERED_FORM, "1-U")).toBe(true);
  expect(allRegisteredExtractorIds()).toContain("1-U");
  expect(allRegisteredForms()).toContain(UNREGISTERED_FORM);
});
