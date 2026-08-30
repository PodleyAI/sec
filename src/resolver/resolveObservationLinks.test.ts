/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The scoped resolve exists so a form module can read back the canonical id of
 * something it just observed. Its whole justification is that it is the corpus
 * pass over a narrower scope rather than a second implementation, so what is
 * pinned here is that the two agree: resolving filing by filing must land every
 * observation on the same canonical id as one pass over the lot.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { buildObserveOnlyEntityObserver } from "./buildObserveOnlyEntityObserver";
import { resolveObservationsForAccession } from "./resolveObservationLinks";
import { ResolveObservationsTask } from "../task/resolve/ResolveObservationsTask";

const VERSION = "1.0.0";
const EXTRACTOR_ID = "D";

/** Two filings per issuer, and one person who appears under both issuers. */
const FILINGS = [
  ["ACC-1", 9001, "2024-01-05"],
  ["ACC-2", 9001, "2024-02-05"],
  ["ACC-3", 9002, "2024-03-05"],
] as const;

async function seedFiling(accession_number: string, cik: number, filing_date: string) {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik,
    accession_number,
    filing_date,
    acceptance_date: `${filing_date}T00:00:00.000Z`,
    report_date: null,
    form: "D",
    file_number: null,
    film_number: null,
    primary_doc: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  });
}

/**
 * The same filings observed the same way every time. Names repeat across
 * accessions on purpose: an observation that resolves to a canonical row an
 * EARLIER filing minted is exactly where a per-filing scope could disagree
 * with one pass over the corpus.
 */
async function observeCorpus(): Promise<void> {
  for (const [accession, cik, date] of FILINGS) await seedFiling(accession, cik, date);
  const observer = buildObserveOnlyEntityObserver();
  const people = [
    ["ACC-1", 9001, "Dana", "Ridge"],
    ["ACC-1", 9001, "Sam", "Ridge"],
    ["ACC-2", 9001, "Dana", "Ridge"],
    ["ACC-3", 9002, "Dana", "Ridge"],
  ] as const;
  let index = 0;
  let last = "";
  for (const [accession, cik, first, lastName] of people) {
    if (accession !== last) {
      index = 0;
      last = accession;
    }
    await observer.observePerson({
      accession_number: accession,
      extractor_id: EXTRACTOR_ID,
      extractor_version: VERSION,
      observation_index: index++,
      source_filing_issuer_cik: cik,
      cik: null,
      first_name: first,
      middle_name: null,
      last_name: lastName,
      suffix: null,
    });
  }
  const companies = [
    ["ACC-1", "Ridge Holdings LLC"],
    ["ACC-2", "Ridge Holdings, L.L.C."],
    ["ACC-3", "Summit Partners Inc"],
  ] as const;
  for (const [accession, name] of companies) {
    await observer.observeCompany({
      accession_number: accession,
      extractor_id: EXTRACTOR_ID,
      extractor_version: VERSION,
      observation_index: 100,
      cik: null,
      name,
      source_context: null,
    });
  }
}

/** `observation_id -> canonical id`, the only thing a resolve pass decides. */
async function personLinks(): Promise<Record<number, string>> {
  const rows = await new PersonIdentityLinkRepo().listAll();
  return Object.fromEntries(
    rows
      .filter((r) => r.resolver_version === VERSION)
      .map((r) => [r.observation_id, r.canonical_person_id])
  );
}

async function companyLinks(): Promise<Record<number, string>> {
  const rows = await new CompanyIdentityLinkRepo().listAll();
  return Object.fromEntries(
    rows
      .filter((r) => r.resolver_version === VERSION)
      .map((r) => [r.observation_id, r.canonical_company_id])
  );
}

describe("resolveObservationsForAccession", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("lands every observation on the canonical id one corpus-wide pass would, filing by filing", async () => {
    await observeCorpus();
    for (const [accession] of FILINGS) {
      await resolveObservationsForAccession({
        kind: "person",
        accession_number: accession,
        resolverVersion: VERSION,
      });
      await resolveObservationsForAccession({
        kind: "company",
        accession_number: accession,
        resolverVersion: VERSION,
      });
    }
    const scopedPersons = await personLinks();
    const scopedCompanies = await companyLinks();

    // Enough observations to make agreement mean something, and enough
    // repetition that a scope which could not see earlier filings would mint
    // extra canonical rows instead of re-finding them. Three people from four
    // observations: Dana under issuer 9001 is re-found across ACC-1 and ACC-2,
    // while Dana under 9002 stays separate — a bare name at a different issuer
    // is not evidence of the same human. Two companies from three: the LLC
    // spellings normalize together.
    expect(Object.keys(scopedPersons)).toHaveLength(4);
    expect(new Set(Object.values(scopedPersons)).size).toBe(3);
    expect(Object.keys(scopedCompanies)).toHaveLength(3);
    expect(new Set(Object.values(scopedCompanies)).size).toBe(2);

    resetDependencyInjectionsForTesting();
    await observeCorpus();
    await new ResolveObservationsTask({
      defaults: { kind: "person", resolverVersion: VERSION },
    }).run();
    await new ResolveObservationsTask({
      defaults: { kind: "company", resolverVersion: VERSION },
    }).run();

    // Canonical ids are minted fresh per run, so the two passes are compared by
    // the PARTITION they induce — which observations share an id — rather than
    // by the ids themselves.
    const partition = (links: Record<number, string>): number[][] => {
      const groups = new Map<string, number[]>();
      for (const [obs, id] of Object.entries(links)) {
        const bucket = groups.get(id) ?? [];
        bucket.push(Number(obs));
        groups.set(id, bucket);
      }
      return [...groups.values()].map((g) => g.sort((a, b) => a - b)).sort((a, b) => a[0]! - b[0]!);
    };
    expect(partition(scopedPersons)).toEqual(partition(await personLinks()));
    expect(partition(scopedCompanies)).toEqual(partition(await companyLinks()));
  });

  it("resolves only the filing it is given", async () => {
    await observeCorpus();
    const result = await resolveObservationsForAccession({
      kind: "person",
      accession_number: "ACC-1",
      resolverVersion: VERSION,
    });

    expect(result).toEqual({ count: 2, skipped: 0 });
    const observations = await new PersonObservationRepo().listByAccession("ACC-1");
    expect(
      Object.keys(await personLinks())
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual(observations.map((o) => o.observation_id).sort((a, b) => a - b));
    expect(await new CompanyObservationRepo().listByAccession("ACC-1")).toHaveLength(1);
    expect(await companyLinks()).toEqual({});
  });
});
