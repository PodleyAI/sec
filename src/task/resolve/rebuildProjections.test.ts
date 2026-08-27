/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import {
  CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
} from "../../storage/canonical/CanonicalJunctionSchemas";
import { CanonicalPersonAddressRepo } from "../../storage/canonical/CanonicalPersonAddressRepo";
import { PersonRoleRepo } from "../../storage/canonical/PersonRoleRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../storage/observation/PersonObservationRepo";
import { ResolveObservationsTask } from "./ResolveObservationsTask";
import type {
  RebuildKind,
  RebuildReport,
  ResolveObservationsTaskOutput,
} from "./ResolveObservationsTask";

const RESOLVER_VERSION = "1.0.0";

/** The company's filing is on disk; the person's deliberately is not. */
const COMPANY_ACCESSION = "0000000000-26-000001";
const PERSON_ACCESSION = "0000000000-26-000002";

async function run(
  kind: "person" | "company",
  rebuildRoles: boolean
): Promise<ResolveObservationsTaskOutput> {
  return new ResolveObservationsTask({
    defaults: { kind, resolverVersion: RESOLVER_VERSION, rebuildRoles },
  }).run();
}

function report(out: ResolveObservationsTaskOutput, kind: RebuildKind): RebuildReport {
  const found = out.rebuilds.find((rebuild) => rebuild.kind === kind);
  if (found === undefined) throw new Error(`no ${kind} report in ${JSON.stringify(out.rebuilds)}`);
  return found;
}

/** A closed tenure an earlier pass left at the resolver version. */
async function seedClosedTenure(): Promise<void> {
  await new PersonRoleRepo().insertTenure({
    canonical_person_id: "canon-earlier",
    resolver_version: RESOLVER_VERSION,
    company_cik: 9000,
    extractor_id: "D",
    role_scope: "form-d:related-person",
    title: "Director",
    normalized_title: "director",
    start_date: "2025-01-10",
    start_accession: "0000000000-25-000001",
    end_date: "2025-06-01",
    end_accession: "0000000000-25-000002",
    last_seen_date: "2025-01-10",
    last_seen_accession: "0000000000-25-000001",
  });
}

describe("ResolveObservationsTask rebuild isolation", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
      cik: 9000,
      accession_number: COMPANY_ACCESSION,
      filing_date: "2026-01-15",
      acceptance_date: "2026-01-15T00:00:00.000Z",
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
    await new CompanyObservationRepo().upsertByNaturalKey({
      accession_number: COMPANY_ACCESSION,
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 9000,
      name: "Blue Acquisition Corp",
      normalized_name: "Blue Acquisition",
      raw_address_id: "addr-company",
      created_at: "2026-01-15T00:00:00.000Z",
    });
    // No `filings` row for this accession: the dangling join both person
    // projections raise on.
    await new PersonObservationRepo().upsertByNaturalKey({
      accession_number: PERSON_ACCESSION,
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      source_filing_issuer_cik: 9000,
      cik: 2001,
      first_name: "Jane",
      last_name: "Smith",
      normalized_first: "Jane",
      normalized_last: "Smith",
      role_scope: "form-d:related-person",
      raw_address_id: "addr-person",
      created_at: "2026-01-15T00:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports each failing projection on its own and runs the rest", async () => {
    // Company links first, so real company junction rows exist before the
    // person pass and their survival below is not vacuous.
    const first = await run("company", false);
    expect(first.count).toBe(1);
    // Only the projection derived from the links this run wrote.
    expect(first.rebuilds.map((rebuild) => rebuild.kind)).toEqual(["company-junctions"]);
    expect(report(first, "company-junctions")).toEqual({
      kind: "company-junctions",
      rows: 1,
      error: null,
    });

    // What an earlier pass left at this version, which the two failing
    // projections would have replaced had they got as far as their purge.
    await new CanonicalPersonAddressRepo().recordObservation({
      canonical_person_id: "canon-earlier",
      address_hash_id: "addr-earlier",
      resolver_version: RESOLVER_VERSION,
      seen_at: "2025-06-01",
    });
    await seedClosedTenure();

    const second = await run("person", true);

    // The resolve pass itself is untouched by any of it.
    expect(second.count).toBe(1);
    expect(second.skipped).toBe(0);

    expect(second.rebuilds.map((rebuild) => rebuild.kind)).toEqual([
      "person-junctions",
      "person-roles",
    ]);
    expect(report(second, "person-junctions").error).toContain(
      `rebuildJunctions: no filing found for accession_number "${PERSON_ACCESSION}"`
    );
    // After a failure, not instead of one: the roles projection still ran once
    // the junction projection raised.
    expect(report(second, "person-roles").error).toContain(
      `rebuildPersonRoles: no filing found for accession_number "${PERSON_ACCESSION}"`
    );
    // The company junction rows the first pass wrote, untouched by a person
    // run that recomputes nothing keyed to the company links.
    const companyRows =
      (await globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN).getAll()) ?? [];
    expect(companyRows).toHaveLength(1);
    expect(companyRows[0].address_hash_id).toBe("addr-company");
    // Each raise lands before its projection deletes anything, so what the
    // earlier pass left is still there — a failed whole-version rebuild does
    // not empty the table it could not replace.
    const personRows =
      (await globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN).getAll()) ?? [];
    expect(personRows).toHaveLength(1);
    expect(personRows[0].address_hash_id).toBe("addr-earlier");
    const tenures = await new PersonRoleRepo().listForPerson("canon-earlier", RESOLVER_VERSION);
    expect(tenures).toHaveLength(1);
    expect(tenures[0].end_date).toBe("2025-06-01");
  });

  it("refuses a roles rebuild on a company run, tenures intact", async () => {
    // The two kinds share this version string, which is what a default install
    // has: `bootstrapComponentVersions` seeds every resolver id at 1.0.0. So
    // person_role at the company run's version is the LIVE person tier, and
    // rebuilding it here would purge tenures no company link can re-derive.
    await seedClosedTenure();

    await expect(run("company", true)).rejects.toThrow(/applies to kind 'person' only/);

    const tenures = await new PersonRoleRepo().listForPerson("canon-earlier", RESOLVER_VERSION);
    expect(tenures).toHaveLength(1);
    expect(tenures[0].end_date).toBe("2025-06-01");
  });

  it("says what a roles rebuild deletes before it deletes it", async () => {
    const warn = vi.mocked(console.warn);
    await run("person", false);
    expect(warn).not.toHaveBeenCalled();

    // The shared fixture withholds this filing so the projections raise before
    // their purge; here the purge is the subject, so the filing goes in.
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
      cik: 9000,
      accession_number: PERSON_ACCESSION,
      filing_date: "2026-01-15",
      acceptance_date: "2026-01-15T00:00:00.000Z",
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
    await seedClosedTenure();

    // What the warning is about, watched as it happens: the purge count read
    // inside the warning itself is the only thing that distinguishes a warning
    // said first from the same words said afterwards.
    const purge = vi.spyOn(PersonRoleRepo.prototype, "deleteForResolverVersion");
    let purgesWhenWarned = -1;
    warn.mockImplementation(() => {
      purgesWhenWarned = purge.mock.calls.length;
    });

    await run("person", true);

    expect(warn.mock.calls.flat().join("\n")).toContain(
      `rebuilding person_role at v${RESOLVER_VERSION}: every tenure at this version is deleted`
    );
    // The purge really ran — otherwise a count of zero at warn time says nothing.
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purgesWhenWarned).toBe(0);
    expect(
      await new PersonRoleRepo().listForPerson("canon-earlier", RESOLVER_VERSION)
    ).toHaveLength(0);
  });
});
