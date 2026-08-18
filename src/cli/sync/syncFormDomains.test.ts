/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { FORM_TO_EXTRACTOR_ID } from "../../storage/versioning/extractorIds";
import {
  SYNC_FORM_DOMAINS,
  formsForExtractorIds,
} from "./syncFormDomains";

type SyncFormDomain = keyof typeof SYNC_FORM_DOMAINS;

function formsElsewhere(exclude: SyncFormDomain): string[] {
  return (Object.keys(SYNC_FORM_DOMAINS) as SyncFormDomain[])
    .filter((domain) => domain !== exclude)
    .flatMap((domain) => formsForExtractorIds(SYNC_FORM_DOMAINS[domain]));
}

function expectPartition(extractorIds: readonly string[], domain: SyncFormDomain): void {
  const domainForms = formsForExtractorIds(SYNC_FORM_DOMAINS[domain]);
  const elsewhere = formsElsewhere(domain);
  const want = new Set(extractorIds);

  for (const [form, extractorId] of Object.entries(FORM_TO_EXTRACTOR_ID)) {
    if (!want.has(extractorId)) {
      continue;
    }
    expect(domainForms, `${form} (${extractorId}) should be in ${domain}`).toContain(form);
    expect(elsewhere, `${form} (${extractorId}) should not appear outside ${domain}`).not.toContain(
      form
    );
  }
}

describe("SYNC_FORM_DOMAINS", () => {
  it("routes every CFPORTAL form to portals only", () => {
    expectPartition(["CFPORTAL"], "portals");
  });

  it("routes every C form to crowdfunding only", () => {
    expectPartition(["C"], "crowdfunding");
  });

  it("routes every reg-a extractor form to reg-a only", () => {
    expectPartition(SYNC_FORM_DOMAINS["reg-a"], "reg-a");
  });

  it("routes every D form to form-d only", () => {
    expectPartition(["D"], "form-d");
  });

  it("includes key SPAC timeline forms and excludes unrelated extractors", () => {
    const spacForms = formsForExtractorIds(SYNC_FORM_DOMAINS.spacs);

    for (const form of [
      "S-1",
      "S-1/A",
      "424B4",
      "8-K",
      "DEFM14A",
      "DEF 14A",
      "25-NSE",
      "20-F",
    ]) {
      expect(spacForms, `expected ${form} in spacs`).toContain(form);
    }

    for (const form of ["D", "C", "3", "4", "RW"]) {
      expect(spacForms, `expected ${form} outside spacs`).not.toContain(form);
    }
  });

  it("has no duplicate forms across domains", () => {
    const allForms = (Object.keys(SYNC_FORM_DOMAINS) as SyncFormDomain[]).flatMap((domain) =>
      formsForExtractorIds(SYNC_FORM_DOMAINS[domain])
    );

    expect(allForms.length).toBe(new Set(allForms).size);
  });
});
