/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { SEC_DB_FOLDER } from "../config/tokens";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { PersonRoleRepo } from "../storage/canonical/PersonRoleRepo";
import { RoleRosterCompletenessRepo } from "../storage/canonical/RoleRosterCompletenessRepo";
import type { PersonRole } from "../storage/canonical/PersonRoleSchema";
import { PERSON_ROLE_REPOSITORY_TOKEN } from "../storage/canonical/PersonRoleSchema";
import { ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN } from "../storage/canonical/RoleRosterCompletenessSchema";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { PersonObservationTitleRepo } from "../storage/observation/PersonObservationTitleRepo";
import { personRoleSnapshotDir } from "./personRoleSnapshot";
import { rebuildPersonRoles } from "./rebuildPersonRoles";
import { reconstructRosterCompleteness } from "./reconstructRosterCompleteness";
import { COMPLETE_ROSTER_ROLE_SCOPES } from "./roleScopes";

const RESOLVER_VERSION = "1.0.0";

/** A generation the rebuild of the active version must not touch. */
const PREVIOUS_RESOLVER_VERSION = "0.9.0";

const EXTRACTOR_ID = "D";
const ROSTER_SCOPE = COMPLETE_ROSTER_ROLE_SCOPES.formDRelatedPerson;
const COMPANY_CIK = 900;

/** The roster filing that named the departing person. */
const FIRST = { accession_number: "ACC-U1", filing_date: "2020-01-01" } as const;
/** The later roster filing that no longer named her, which closed the tenure. */
const SECOND = { accession_number: "ACC-U2", filing_date: "2021-01-01" } as const;

const DEPARTED_PERSON = "person-departed";
const STAYING_PERSON = "person-staying";

async function seedFiling(accession_number: string, filing_date: string): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik: COMPANY_CIK,
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
 * One person observation as a corpus predating `person_observations.role_scope`
 * carries it: every column the extraction wrote, and a null scope, because the
 * column was added with no backfill.
 */
async function seedObservation(spec: {
  readonly accession_number: string;
  readonly observation_index: number;
  readonly last_name: string;
  readonly canonical_person_id: string;
  readonly role_scope?: string;
}): Promise<number> {
  const observation = await new PersonObservationRepo().upsertByNaturalKey({
    accession_number: spec.accession_number,
    extractor_id: EXTRACTOR_ID,
    extractor_version: "1.0.0",
    observation_index: spec.observation_index,
    source_filing_issuer_cik: COMPANY_CIK,
    last_name: spec.last_name,
    normalized_last: spec.last_name.toLowerCase(),
    role_scope: spec.role_scope ?? null,
    created_at: new Date().toISOString(),
  });
  await new PersonObservationTitleRepo().replaceForObservation(observation.observation_id, [
    "Director",
  ]);
  await new PersonIdentityLinkRepo().upsert(
    observation.observation_id,
    RESOLVER_VERSION,
    spec.canonical_person_id
  );
  return observation.observation_id;
}

/** Stamp the scope a re-extraction would now write, leaving everything else. */
async function reExtractWithScope(
  accession_number: string,
  observation_index: number,
  last_name: string,
  canonical_person_id: string
): Promise<void> {
  await seedObservation({
    accession_number,
    observation_index,
    last_name,
    canonical_person_id,
    role_scope: ROSTER_SCOPE,
  });
}

async function allTenures(): Promise<PersonRole[]> {
  return (await globalServiceRegistry.get(PERSON_ROLE_REPOSITORY_TOKEN).getAll()) ?? [];
}

/**
 * The corpus this file is about: two roster filings, a person who left between
 * them, one who did not, tenures the incremental path already closed — and
 * neither of the two columns a rebuild needs.
 */
async function seedUnbackfilledCorpus(): Promise<void> {
  await seedFiling(FIRST.accession_number, FIRST.filing_date);
  await seedFiling(SECOND.accession_number, SECOND.filing_date);

  await seedObservation({
    accession_number: FIRST.accession_number,
    observation_index: 0,
    last_name: "Departed",
    canonical_person_id: DEPARTED_PERSON,
  });
  await seedObservation({
    accession_number: FIRST.accession_number,
    observation_index: 1,
    last_name: "Staying",
    canonical_person_id: STAYING_PERSON,
  });
  await seedObservation({
    accession_number: SECOND.accession_number,
    observation_index: 0,
    last_name: "Staying",
    canonical_person_id: STAYING_PERSON,
  });

  const roleRepo = new PersonRoleRepo();
  await roleRepo.insertTenure({
    canonical_person_id: DEPARTED_PERSON,
    resolver_version: RESOLVER_VERSION,
    company_cik: COMPANY_CIK,
    extractor_id: EXTRACTOR_ID,
    role_scope: ROSTER_SCOPE,
    title: "Director",
    normalized_title: "director",
    start_date: FIRST.filing_date,
    start_accession: FIRST.accession_number,
    end_date: SECOND.filing_date,
    end_accession: SECOND.accession_number,
    last_seen_date: FIRST.filing_date,
    last_seen_accession: FIRST.accession_number,
  });
  await roleRepo.insertTenure({
    canonical_person_id: STAYING_PERSON,
    resolver_version: RESOLVER_VERSION,
    company_cik: COMPANY_CIK,
    extractor_id: EXTRACTOR_ID,
    role_scope: ROSTER_SCOPE,
    title: "Director",
    normalized_title: "director",
    start_date: FIRST.filing_date,
    start_accession: FIRST.accession_number,
    end_date: null,
    end_accession: null,
    last_seen_date: SECOND.filing_date,
    last_seen_accession: SECOND.accession_number,
  });
  // A retired generation's tenure: the purge is scoped, so this must survive
  // the rebuild — and must not appear in the snapshot of the version purged.
  await roleRepo.insertTenure({
    canonical_person_id: DEPARTED_PERSON,
    resolver_version: PREVIOUS_RESOLVER_VERSION,
    company_cik: COMPANY_CIK,
    extractor_id: EXTRACTOR_ID,
    role_scope: ROSTER_SCOPE,
    title: "Director",
    normalized_title: "director",
    start_date: FIRST.filing_date,
    start_accession: FIRST.accession_number,
    end_date: SECOND.filing_date,
    end_accession: SECOND.accession_number,
    last_seen_date: FIRST.filing_date,
    last_seen_accession: FIRST.accession_number,
  });
}

/** Every snapshot file written since the temp directory was made, oldest first. */
function snapshotFiles(): string[] {
  const dir = personRoleSnapshotDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.sort().map((name) => join(dir, name));
}

function readSnapshot(file: string): PersonRole[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as PersonRole);
}

describe("rebuildPersonRoles over a corpus with no role_scope and no completeness rows", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    // Snapshots land beside the database; point that at a directory this test
    // owns so the file it asserts on cannot be one an earlier run left.
    globalServiceRegistry.registerInstance(
      SEC_DB_FOLDER,
      mkdtempSync(join(tmpdir(), "sec-role-snapshot-"))
    );
  });

  it("empties the resolver version: every observation is skipped for want of a scope, and the purge has already run", async () => {
    await seedUnbackfilledCorpus();
    expect((await allTenures()).length).toBe(3);

    expect(await rebuildPersonRoles(RESOLVER_VERSION)).toEqual({ rows: 0 });

    // Not "departures read as open" — nothing at this version is left at all.
    const remaining = await allTenures();
    expect(remaining.filter((t) => t.resolver_version === RESOLVER_VERSION)).toEqual([]);
    expect(remaining.map((t) => t.resolver_version)).toEqual([PREVIOUS_RESOLVER_VERSION]);
  });

  it("writes the version's tenures to a snapshot file before the purge, and only that version's", async () => {
    await seedUnbackfilledCorpus();
    const before = (await allTenures()).filter((t) => t.resolver_version === RESOLVER_VERSION);

    await rebuildPersonRoles(RESOLVER_VERSION);

    const files = snapshotFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/person_role-1\.0\.0-.*\.ndjson$/);
    const saved = readSnapshot(files[0]);
    // Full rows, so the file is the whole of what the purge removed.
    expect([...saved].sort((a, b) => a.role_id - b.role_id)).toEqual(
      [...before].sort((a, b) => a.role_id - b.role_id)
    );
    expect(saved.map((t) => t.resolver_version)).toEqual([RESOLVER_VERSION, RESOLVER_VERSION]);
  });

  it("re-extraction alone brings the tenures back OPEN: with no completeness row, nothing closes", async () => {
    await seedUnbackfilledCorpus();

    // The scope half of the recovery, and only it.
    await reExtractWithScope(FIRST.accession_number, 0, "Departed", DEPARTED_PERSON);
    await reExtractWithScope(FIRST.accession_number, 1, "Staying", STAYING_PERSON);
    await reExtractWithScope(SECOND.accession_number, 0, "Staying", STAYING_PERSON);

    expect(await rebuildPersonRoles(RESOLVER_VERSION)).toEqual({ rows: 2 });
    const departed = (await allTenures()).find(
      (t) => t.resolver_version === RESOLVER_VERSION && t.canonical_person_id === DEPARTED_PERSON
    );
    expect(departed?.end_date).toBeNull();
    expect(departed?.end_accession).toBeNull();
  });

  it("reconstruction before re-extraction restores the closure exactly", async () => {
    await seedUnbackfilledCorpus();

    expect(await reconstructRosterCompleteness()).toEqual({
      tenures: 3,
      // Both generations' closed tenures name the same closing filing, so the
      // two collapse to one decision about that filing's roster.
      closures: 1,
      written: 1,
      alreadyRecorded: 0,
      unattributed: 0,
    });
    expect(
      await new RoleRosterCompletenessRepo().listForAccessions([SECOND.accession_number])
    ).toEqual([
      {
        accession_number: SECOND.accession_number,
        extractor_id: EXTRACTOR_ID,
        role_scope: ROSTER_SCOPE,
        company_cik: COMPANY_CIK,
        filing_date: SECOND.filing_date,
        complete: true,
      },
    ]);

    await reExtractWithScope(FIRST.accession_number, 0, "Departed", DEPARTED_PERSON);
    await reExtractWithScope(FIRST.accession_number, 1, "Staying", STAYING_PERSON);
    await reExtractWithScope(SECOND.accession_number, 0, "Staying", STAYING_PERSON);

    expect(await rebuildPersonRoles(RESOLVER_VERSION)).toEqual({ rows: 2 });
    const rebuilt = await allTenures();
    const departed = rebuilt.find(
      (t) => t.resolver_version === RESOLVER_VERSION && t.canonical_person_id === DEPARTED_PERSON
    );
    expect(departed?.end_date).toBe(SECOND.filing_date);
    expect(departed?.end_accession).toBe(SECOND.accession_number);
    const staying = rebuilt.find(
      (t) => t.resolver_version === RESOLVER_VERSION && t.canonical_person_id === STAYING_PERSON
    );
    expect(staying?.end_date).toBeNull();
  });

  it("is idempotent, and never overwrites a decision already recorded", async () => {
    await seedUnbackfilledCorpus();

    expect((await reconstructRosterCompleteness()).written).toBe(1);
    expect(await reconstructRosterCompleteness()).toEqual({
      tenures: 3,
      closures: 1,
      written: 0,
      alreadyRecorded: 1,
      unattributed: 0,
    });

    // A re-extraction that has since declined a row wrote `false`; the closure
    // it made before that must not restore it to `true`.
    await globalServiceRegistry.get(ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN).put({
      accession_number: SECOND.accession_number,
      extractor_id: EXTRACTOR_ID,
      role_scope: ROSTER_SCOPE,
      company_cik: COMPANY_CIK,
      filing_date: SECOND.filing_date,
      complete: false,
    });
    expect((await reconstructRosterCompleteness()).written).toBe(0);
    expect(
      (await new RoleRosterCompletenessRepo().listForAccessions([SECOND.accession_number]))[0]
        .complete
    ).toBe(false);
  });

  it("counts an end date naming no closing accession rather than guessing one", async () => {
    await seedFiling(FIRST.accession_number, FIRST.filing_date);
    await new PersonRoleRepo().insertTenure({
      canonical_person_id: DEPARTED_PERSON,
      resolver_version: RESOLVER_VERSION,
      company_cik: COMPANY_CIK,
      extractor_id: EXTRACTOR_ID,
      role_scope: ROSTER_SCOPE,
      title: "Director",
      normalized_title: "director",
      start_date: FIRST.filing_date,
      start_accession: FIRST.accession_number,
      end_date: SECOND.filing_date,
      end_accession: null,
      last_seen_date: FIRST.filing_date,
      last_seen_accession: FIRST.accession_number,
    });

    expect(await reconstructRosterCompleteness()).toEqual({
      tenures: 1,
      closures: 0,
      written: 0,
      alreadyRecorded: 0,
      unattributed: 1,
    });
  });
});
