/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import {
  clearFormExtractorsForTesting,
  extractorKey,
  registerFormExtractor,
} from "../../sec/forms/formExtractors";
import { expandFormTypes, formsForExtractorIds } from "./syncFormDomains";

/**
 * The registry is keyed `(id, section)` while every caller here names an
 * extractor by id alone. The two coincide for an extractor registered without
 * a section — which is every extractor sec ships — so a lookup that matched
 * ids against keys answered correctly right up until the first sectioned
 * registration, and then returned nothing at all.
 *
 * The fixture is one extractor registered WITH a section, through nothing but
 * the public seam, over a real EDGAR form symbol no shipped extractor handles.
 */
const SECTIONED_ID = "downstream-milestone";
const SECTIONED_SECTION = "deal-terms";
const SECTIONED_FORM = "8-K12B";

const noopStore = async (): Promise<void> => {};

beforeAll(() => {
  // sec's own extractors FIRST so the once-per-generation guard is armed and
  // the registration below is additive rather than replaceable.
  registerSecFormExtractors();
  registerFormExtractor({
    id: SECTIONED_ID,
    section: SECTIONED_SECTION,
    forms: [SECTIONED_FORM],
    store: noopStore,
  });
});

afterAll(() => {
  clearFormExtractorsForTesting();
  registerSecFormExtractors();
});

describe("form lookups over a sectioned registration", () => {
  it("expands a sectioned extractor id to the forms it handles", () => {
    expect(formsForExtractorIds([SECTIONED_ID])).toEqual([SECTIONED_FORM]);
  });

  it("answers ids, not registry keys, so a sectioned key expands to nothing", () => {
    expect(formsForExtractorIds([extractorKey(SECTIONED_ID, SECTIONED_SECTION)])).toEqual([]);
  });

  it("keeps expanding the unsectioned extractors sec ships", () => {
    expect(formsForExtractorIds(["D"]).sort()).toEqual(["D", "D/A"]);
  });

  it("recognises a sectioned id as an extractor token, not a literal form code", () => {
    expect(expandFormTypes([SECTIONED_ID])).toEqual([SECTIONED_FORM]);
  });

  it("still leaves a form code that is nobody's extractor id alone", () => {
    expect(expandFormTypes(["D/A"])).toEqual(["D/A"]);
  });
});
