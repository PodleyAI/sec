/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { allRegisteredForms, extractorIdsForForm } from "../../sec/forms/formExtractors";
import { PARSER_ONLY_FORMS_BY_EXTRACTOR } from "../../sec/forms/parserOnlyForms";
import { expandFormTypes, formsForExtractorIds, SYNC_FORM_DOMAINS } from "./syncFormDomains";

// Importing `./syncFormDomains` registers sec's form extractors at its module
// scope, so the registry reads below are already populated.

/** Every (form, extractor id) pair the registry routes — a form may yield several. */
function routedPairs(): ReadonlyArray<readonly [string, string]> {
  return allRegisteredForms().flatMap((form) =>
    extractorIdsForForm(form).map((id) => [form, id] as const)
  );
}

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

  for (const [form, extractorId] of routedPairs()) {
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

    for (const form of ["S-1", "S-1/A", "424B4", "8-K"]) {
      expect(spacForms, `expected ${form} in spacs`).toContain(form);
    }

    for (const form of ["D", "C", "3", "4", "RW"]) {
      expect(spacForms, `expected ${form} outside spacs`).not.toContain(form);
    }
  });

  it("contributes no proxy or listing-removal form on its own, while still naming the extractors that read them", () => {
    // The proxies were in this domain until their reading moved to a consumer
    // package, and the listing removals followed. An id nothing registers
    // contributes no forms, so a sec-only sweep of `spacs` has none of them —
    // and the domain still has to NAME the id, or the deployment that supplies
    // it would sweep those filings out of the SPAC timeline they belong to.
    // Both halves asserted, since dropping either one is silent.
    const spacForms = formsForExtractorIds(SYNC_FORM_DOMAINS.spacs);
    expect(SYNC_FORM_DOMAINS.spacs).toContain("merger-proxy");
    expect(SYNC_FORM_DOMAINS.spacs).toContain("25-15");
    for (const form of ["DEFM14A", "DEF 14A"]) {
      expect(spacForms, `expected ${form} outside a sec-only spacs sweep`).not.toContain(form);
      expect(PARSER_ONLY_FORMS_BY_EXTRACTOR["merger-proxy"], `${form} is pinned`).toContain(form);
    }
    for (const form of ["25-NSE", "20-F"]) {
      expect(spacForms, `expected ${form} outside a sec-only spacs sweep`).not.toContain(form);
      expect(PARSER_ONLY_FORMS_BY_EXTRACTOR["25-15"], `${form} is pinned`).toContain(form);
    }
  });

  it("has no duplicate forms across domains", () => {
    const allForms = (Object.keys(SYNC_FORM_DOMAINS) as SyncFormDomain[]).flatMap((domain) =>
      formsForExtractorIds(SYNC_FORM_DOMAINS[domain])
    );

    expect(allForms.length).toBe(new Set(allForms).size);
  });
});

describe("expandFormTypes", () => {
  it("expands an extractor id to every form that extractor handles", () => {
    const forms = expandFormTypes(["D"]);
    expect(forms).toContain("D");
    expect(forms).toContain("D/A");
  });

  it("leaves a specific form code alone so D/A does not pull in original D filings", () => {
    expect(expandFormTypes(["D/A"])).toEqual(["D/A"]);
  });

  it("does not duplicate when the extractor and one of its forms are both named", () => {
    const forms = expandFormTypes(["D", "D/A"]);
    expect(forms.filter((form) => form === "D/A")).toHaveLength(1);
    expect(forms).toContain("D");
  });
});
