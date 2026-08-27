/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { CanonicalPersonAliasRepo } from "../storage/canonical/CanonicalPersonAliasRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { PersonRoleRepo } from "../storage/canonical/PersonRoleRepo";
import { RoleRosterCompletenessRepo } from "../storage/canonical/RoleRosterCompletenessRepo";
import type { PersonRole } from "../storage/canonical/PersonRoleSchema";
import { PERSON_ROLE_REPOSITORY_TOKEN } from "../storage/canonical/PersonRoleSchema";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { PersonObservationTitleRepo } from "../storage/observation/PersonObservationTitleRepo";
import type { EntityObserver } from "./EntityObserver";
import { buildEntityObserver } from "./buildEntityObserver";
import { rebuildPersonRoles } from "./rebuildPersonRoles";
import { COMPLETE_ROSTER_ROLE_SCOPES } from "./roleScopes";

const RESOLVER_VERSION = "1.0.0";

/**
 * A generation `dropPrevious` would retire — rows written at it must survive a
 * rebuild of the active version untouched.
 */
const PREVIOUS_RESOLVER_VERSION = "0.9.0";

const EXTRACTOR_ID = "D";

/** A list that names everyone holding the role, so absence closes a tenure. */
const ROSTER_SCOPE = COMPLETE_ROSTER_ROLE_SCOPES.formDRelatedPerson;

/** A list that names only whoever appeared, so absence proves nothing. */
const ASSERT_ONLY_SCOPE = "form-d:signature";

/**
 * The tenure columns the projection must reproduce exactly. `role_id` is an
 * autoincrement surrogate the rebuild re-mints, and `created_at` is the wall
 * clock at write time rather than anything derived from the filings.
 */
type ComparableTenure = Omit<PersonRole, "role_id" | "created_at">;

async function seedFiling(
  accession_number: string,
  cik: number,
  filing_date: string
): Promise<void> {
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

async function observeRoleClaim(
  observer: EntityObserver,
  spec: {
    readonly accession_number: string;
    readonly filing_date: string;
    readonly company_cik: number;
    readonly person_cik: number;
    readonly last_name: string;
    readonly titles: readonly string[];
    readonly role_scope: string;
    readonly observation_index: number;
  }
): Promise<{ canonical_person_id: string; observation_id: number }> {
  return await observer.observePerson({
    accession_number: spec.accession_number,
    extractor_id: EXTRACTOR_ID,
    extractor_version: "1.0.0",
    observation_index: spec.observation_index,
    source_filing_issuer_cik: spec.company_cik,
    cik: spec.person_cik,
    last_name: spec.last_name,
    titles: spec.titles,
    filing_date: spec.filing_date,
    role_scope: spec.role_scope,
  });
}

async function closeRoster(
  observer: EntityObserver,
  spec: {
    readonly accession_number: string;
    readonly company_cik: number;
    readonly filing_date: string;
    readonly role_scope: string;
  }
): Promise<number> {
  return await observer.closeUnassertedPersonRoles({
    accession_number: spec.accession_number,
    extractor_id: EXTRACTOR_ID,
    role_scope: spec.role_scope,
    company_cik: spec.company_cik,
    filing_date: spec.filing_date,
  });
}

async function allTenures(): Promise<PersonRole[]> {
  return (await globalServiceRegistry.get(PERSON_ROLE_REPOSITORY_TOKEN).getAll()) ?? [];
}

function tenureKey(row: ComparableTenure): string {
  return [
    row.canonical_person_id,
    row.resolver_version,
    String(row.company_cik),
    row.extractor_id,
    row.role_scope,
    row.normalized_title,
    row.start_date,
  ].join("|");
}

/** Every tenure column but the two that legitimately differ, in a stable order. */
function comparable(rows: readonly PersonRole[]): ComparableTenure[] {
  return rows
    .map(({ role_id, created_at, ...rest }) => rest)
    .sort((a, b) => {
      const left = tenureKey(a);
      const right = tenureKey(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

function tenureFor(
  rows: readonly PersonRole[],
  spec: {
    readonly canonical_person_id: string;
    readonly normalized_title: string;
    readonly role_scope: string;
  }
): PersonRole | undefined {
  return rows.find(
    (r) =>
      r.canonical_person_id === spec.canonical_person_id &&
      r.normalized_title === spec.normalized_title &&
      r.role_scope === spec.role_scope
  );
}

/** Reap an observation the way `reapStaleObservations` does: children, links, row. */
async function reapObservation(observation_id: number): Promise<void> {
  await new PersonObservationTitleRepo().deleteForObservation(observation_id);
  await new PersonIdentityLinkRepo().deleteForObservation(observation_id);
  await new PersonObservationRepo().deleteByObservationId(observation_id);
}

describe("rebuildPersonRoles", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("reproduces the incrementally maintained tenures on every column but role_id and created_at — re-open, phantom delete, tightened end, departure and return", async () => {
    for (const [accession, cik, date] of [
      ["ACC-A1", 700, "2020-01-01"],
      ["ACC-A2", 700, "2021-01-01"],
      ["ACC-A3", 700, "2022-01-01"],
      ["ACC-B1", 701, "2020-01-01"],
      ["ACC-B2", 701, "2021-01-01"],
      ["ACC-B3", 701, "2022-01-01"],
      ["ACC-C1", 702, "2023-05-01"],
      ["ACC-C2", 702, "2023-09-01"],
      ["ACC-D1", 703, "2024-01-01"],
      ["ACC-E1", 704, "2023-01-10"],
      ["ACC-E2", 704, "2024-06-15"],
      ["ACC-F1", 705, "2022-01-01"],
      ["ACC-F2", 705, "2023-01-01"],
      ["ACC-F3", 705, "2023-06-01"],
      ["ACC-F4", 705, "2024-01-01"],
      ["ACC-G1", 706, "2022-03-01"],
      ["ACC-G2", 706, "2023-03-01"],
      ["ACC-P1", 715, "2024-02-01"],
      ["ACC-P2", 715, "2024-02-01"],
      ["ACC-N1", 707, "2022-05-01"],
    ] as const) {
      await seedFiling(accession, cik, date);
    }

    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });

    // --- Company 700: a departure and a return, which is two tenure rows. ---
    const cora = await observeRoleClaim(observer, {
      accession_number: "ACC-A1",
      filing_date: "2020-01-01",
      company_cik: 700,
      person_cik: 4001,
      last_name: "Comeback",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    await closeRoster(observer, {
      accession_number: "ACC-A1",
      company_cik: 700,
      filing_date: "2020-01-01",
      role_scope: ROSTER_SCOPE,
    });
    const sam = await observeRoleClaim(observer, {
      accession_number: "ACC-A2",
      filing_date: "2021-01-01",
      company_cik: 700,
      person_cik: 4002,
      last_name: "Successor",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    expect(
      await closeRoster(observer, {
        accession_number: "ACC-A2",
        company_cik: 700,
        filing_date: "2021-01-01",
        role_scope: ROSTER_SCOPE,
      })
    ).toBe(1);
    await observeRoleClaim(observer, {
      accession_number: "ACC-A3",
      filing_date: "2022-01-01",
      company_cik: 700,
      person_cik: 4001,
      last_name: "Comeback",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    await observeRoleClaim(observer, {
      accession_number: "ACC-A3",
      filing_date: "2022-01-01",
      company_cik: 700,
      person_cik: 4002,
      last_name: "Successor",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 1,
    });
    await closeRoster(observer, {
      accession_number: "ACC-A3",
      company_cik: 700,
      filing_date: "2022-01-01",
      role_scope: ROSTER_SCOPE,
    });

    // --- Company 701: an out-of-order older roster tightens a closed end. ---
    const terry = await observeRoleClaim(observer, {
      accession_number: "ACC-B1",
      filing_date: "2020-01-01",
      company_cik: 701,
      person_cik: 4003,
      last_name: "Tighten",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    await closeRoster(observer, {
      accession_number: "ACC-B1",
      company_cik: 701,
      filing_date: "2020-01-01",
      role_scope: ROSTER_SCOPE,
    });
    const olive = await observeRoleClaim(observer, {
      accession_number: "ACC-B3",
      filing_date: "2022-01-01",
      company_cik: 701,
      person_cik: 4004,
      last_name: "Other",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    expect(
      await closeRoster(observer, {
        accession_number: "ACC-B3",
        company_cik: 701,
        filing_date: "2022-01-01",
        role_scope: ROSTER_SCOPE,
      })
    ).toBe(1);
    // The filing between the two arrives last, and is earlier evidence of the
    // same departure.
    await observeRoleClaim(observer, {
      accession_number: "ACC-B2",
      filing_date: "2021-01-01",
      company_cik: 701,
      person_cik: 4004,
      last_name: "Other",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    await closeRoster(observer, {
      accession_number: "ACC-B2",
      company_cik: 701,
      filing_date: "2021-01-01",
      role_scope: ROSTER_SCOPE,
    });

    // --- Company 702: a re-extraction re-opens the tenure it itself closed. ---
    const mona = await observeRoleClaim(observer, {
      accession_number: "ACC-C1",
      filing_date: "2023-05-01",
      company_cik: 702,
      person_cik: 4005,
      last_name: "Missed",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    await closeRoster(observer, {
      accession_number: "ACC-C1",
      company_cik: 702,
      filing_date: "2023-05-01",
      role_scope: ROSTER_SCOPE,
    });
    // A buggy extraction of the next filing sees only the colleague.
    const cole = await observeRoleClaim(observer, {
      accession_number: "ACC-C2",
      filing_date: "2023-09-01",
      company_cik: 702,
      person_cik: 4006,
      last_name: "Colleague",
      titles: ["Executive Officer"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    expect(
      await closeRoster(observer, {
        accession_number: "ACC-C2",
        company_cik: 702,
        filing_date: "2023-09-01",
        role_scope: ROSTER_SCOPE,
      })
    ).toBe(1);
    // Re-extraction of the SAME filing now finds them both.
    await observeRoleClaim(observer, {
      accession_number: "ACC-C2",
      filing_date: "2023-09-01",
      company_cik: 702,
      person_cik: 4005,
      last_name: "Missed",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    await observeRoleClaim(observer, {
      accession_number: "ACC-C2",
      filing_date: "2023-09-01",
      company_cik: 702,
      person_cik: 4006,
      last_name: "Colleague",
      titles: ["Executive Officer"],
      role_scope: ROSTER_SCOPE,
      observation_index: 1,
    });
    await closeRoster(observer, {
      accession_number: "ACC-C2",
      company_cik: 702,
      filing_date: "2023-09-01",
      role_scope: ROSTER_SCOPE,
    });

    // --- Company 703: a re-extraction drops a person it alone supported. ---
    const phanta = await observeRoleClaim(observer, {
      accession_number: "ACC-D1",
      filing_date: "2024-01-01",
      company_cik: 703,
      person_cik: 4007,
      last_name: "Phantom",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    const rita = await observeRoleClaim(observer, {
      accession_number: "ACC-D1",
      filing_date: "2024-01-01",
      company_cik: 703,
      person_cik: 4008,
      last_name: "Real",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 1,
    });
    await closeRoster(observer, {
      accession_number: "ACC-D1",
      company_cik: 703,
      filing_date: "2024-01-01",
      role_scope: ROSTER_SCOPE,
    });
    // The re-extraction returns one row where there were two: the phantom is
    // gone and the real person moves up an index.
    await observeRoleClaim(observer, {
      accession_number: "ACC-D1",
      filing_date: "2024-01-01",
      company_cik: 703,
      person_cik: 4008,
      last_name: "Real",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    await reapObservation(rita.observation_id);
    expect(
      await closeRoster(observer, {
        accession_number: "ACC-D1",
        company_cik: 703,
        filing_date: "2024-01-01",
        role_scope: ROSTER_SCOPE,
      })
    ).toBe(1);

    // --- Company 704: one person, two titles, only one of them ends. ---
    const bea = await observeRoleClaim(observer, {
      accession_number: "ACC-E1",
      filing_date: "2023-01-10",
      company_cik: 704,
      person_cik: 4009,
      last_name: "Boarder",
      titles: ["Chairman of the Board of Directors"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    await closeRoster(observer, {
      accession_number: "ACC-E1",
      company_cik: 704,
      filing_date: "2023-01-10",
      role_scope: ROSTER_SCOPE,
    });
    await observeRoleClaim(observer, {
      accession_number: "ACC-E2",
      filing_date: "2024-06-15",
      company_cik: 704,
      person_cik: 4009,
      last_name: "Boarder",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    expect(
      await closeRoster(observer, {
        accession_number: "ACC-E2",
        company_cik: 704,
        filing_date: "2024-06-15",
        role_scope: ROSTER_SCOPE,
      })
    ).toBe(1);

    // --- Company 705: the same person in a roster list and an assert-only
    // list. The roster closes its own tenure; the assert-only list never
    // closes anything, however many later filings omit them. ---
    const dee = await observeRoleClaim(observer, {
      accession_number: "ACC-F1",
      filing_date: "2022-01-01",
      company_cik: 705,
      person_cik: 4010,
      last_name: "Dual",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    await closeRoster(observer, {
      accession_number: "ACC-F1",
      company_cik: 705,
      filing_date: "2022-01-01",
      role_scope: ROSTER_SCOPE,
    });
    await observeRoleClaim(observer, {
      accession_number: "ACC-F2",
      filing_date: "2023-01-01",
      company_cik: 705,
      person_cik: 4010,
      last_name: "Dual",
      titles: ["Director"],
      role_scope: ASSERT_ONLY_SCOPE,
      observation_index: 1,
    });
    const sig = await observeRoleClaim(observer, {
      accession_number: "ACC-F3",
      filing_date: "2023-06-01",
      company_cik: 705,
      person_cik: 4011,
      last_name: "Signer",
      titles: ["Director"],
      role_scope: ASSERT_ONLY_SCOPE,
      observation_index: 1,
    });
    const ollie = await observeRoleClaim(observer, {
      accession_number: "ACC-F4",
      filing_date: "2024-01-01",
      company_cik: 705,
      person_cik: 4012,
      last_name: "Onlynow",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    expect(
      await closeRoster(observer, {
        accession_number: "ACC-F4",
        company_cik: 705,
        filing_date: "2024-01-01",
        role_scope: ROSTER_SCOPE,
      })
    ).toBe(1);

    // --- Company 706: a roster naming someone whose titles all filter away
    // is incomplete, so it closes nothing. ---
    const ivy = await observeRoleClaim(observer, {
      accession_number: "ACC-G1",
      filing_date: "2022-03-01",
      company_cik: 706,
      person_cik: 4013,
      last_name: "Incumbent",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    await closeRoster(observer, {
      accession_number: "ACC-G1",
      company_cik: 706,
      filing_date: "2022-03-01",
      role_scope: ROSTER_SCOPE,
    });
    await observeRoleClaim(observer, {
      accession_number: "ACC-G2",
      filing_date: "2023-03-01",
      company_cik: 706,
      person_cik: 4014,
      last_name: "Placeholder",
      titles: ["Signer"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    const quinn = await observeRoleClaim(observer, {
      accession_number: "ACC-G2",
      filing_date: "2023-03-01",
      company_cik: 706,
      person_cik: 4015,
      last_name: "Quorum",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 1,
    });
    expect(
      await closeRoster(observer, {
        accession_number: "ACC-G2",
        company_cik: 706,
        filing_date: "2023-03-01",
        role_scope: ROSTER_SCOPE,
      })
    ).toBe(0);

    // --- Company 715: two rosters filed the SAME day, each naming someone the
    // other does not. Neither is later evidence of the other's departure. ---
    const pat = await observeRoleClaim(observer, {
      accession_number: "ACC-P1",
      filing_date: "2024-02-01",
      company_cik: 715,
      person_cik: 4018,
      last_name: "Pairfiled",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    expect(
      await closeRoster(observer, {
        accession_number: "ACC-P1",
        company_cik: 715,
        filing_date: "2024-02-01",
        role_scope: ROSTER_SCOPE,
      })
    ).toBe(0);
    const quill = await observeRoleClaim(observer, {
      accession_number: "ACC-P2",
      filing_date: "2024-02-01",
      company_cik: 715,
      person_cik: 4019,
      last_name: "Sameday",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    expect(
      await closeRoster(observer, {
        accession_number: "ACC-P2",
        company_cik: 715,
        filing_date: "2024-02-01",
        role_scope: ROSTER_SCOPE,
      })
    ).toBe(0);

    // --- Company 707: a claim with no role_scope mints no tenure at all. ---
    const nora = await observer.observePerson({
      accession_number: "ACC-N1",
      extractor_id: EXTRACTOR_ID,
      extractor_version: "1.0.0",
      observation_index: 0,
      source_filing_issuer_cik: 707,
      cik: 4017,
      last_name: "Noscope",
      titles: ["Director"],
      filing_date: "2022-05-01",
    });

    const snapshot = await allTenures();

    // The incremental path's own outcome, pinned before it is compared —
    // an equality against an empty or accidental snapshot proves nothing.
    expect(snapshot).toHaveLength(18);
    expect(snapshot.every((r) => r.resolver_version === RESOLVER_VERSION)).toBe(true);
    expect(snapshot.some((r) => r.canonical_person_id === nora.canonical_person_id)).toBe(false);

    const coraClosed = snapshot.filter(
      (r) => r.canonical_person_id === cora.canonical_person_id && r.end_date !== null
    );
    const coraOpen = snapshot.filter(
      (r) => r.canonical_person_id === cora.canonical_person_id && r.end_date === null
    );
    expect(coraClosed).toHaveLength(1);
    expect(coraOpen).toHaveLength(1);
    expect(coraClosed[0].end_date).toBe("2021-01-01");
    expect(coraOpen[0].start_date).toBe("2022-01-01");
    expect(
      tenureFor(snapshot, {
        canonical_person_id: terry.canonical_person_id,
        normalized_title: "director",
        role_scope: ROSTER_SCOPE,
      })?.end_date
    ).toBe("2021-01-01");
    expect(
      tenureFor(snapshot, {
        canonical_person_id: mona.canonical_person_id,
        normalized_title: "director",
        role_scope: ROSTER_SCOPE,
      })?.end_date
    ).toBeNull();
    expect(snapshot.some((r) => r.canonical_person_id === phanta.canonical_person_id)).toBe(false);
    expect(
      tenureFor(snapshot, {
        canonical_person_id: bea.canonical_person_id,
        normalized_title: "chairman of the board of directors",
        role_scope: ROSTER_SCOPE,
      })?.end_date
    ).toBe("2024-06-15");
    expect(
      tenureFor(snapshot, {
        canonical_person_id: bea.canonical_person_id,
        normalized_title: "director",
        role_scope: ROSTER_SCOPE,
      })?.end_date
    ).toBeNull();
    expect(
      tenureFor(snapshot, {
        canonical_person_id: dee.canonical_person_id,
        normalized_title: "director",
        role_scope: ROSTER_SCOPE,
      })?.end_date
    ).toBe("2024-01-01");
    expect(
      tenureFor(snapshot, {
        canonical_person_id: dee.canonical_person_id,
        normalized_title: "director",
        role_scope: ASSERT_ONLY_SCOPE,
      })?.end_date
    ).toBeNull();
    expect(
      tenureFor(snapshot, {
        canonical_person_id: ivy.canonical_person_id,
        normalized_title: "director",
        role_scope: ROSTER_SCOPE,
      })?.end_date
    ).toBeNull();
    expect(
      tenureFor(snapshot, {
        canonical_person_id: pat.canonical_person_id,
        normalized_title: "director",
        role_scope: ROSTER_SCOPE,
      })?.end_date
    ).toBeNull();

    const result = await rebuildPersonRoles(RESOLVER_VERSION);
    expect(result).toEqual({ rows: 18 });

    const rebuilt = await allTenures();
    expect(comparable(rebuilt)).toEqual(comparable(snapshot));
    // The two excluded columns still have to be sane: fresh surrogate keys and
    // a timestamp stamped by this write. Both halves are needed. A shape check
    // cannot tell a fresh stamp from one carried off the pre-rebuild row, so
    // compare against the newest thing the incremental path left behind —
    // every rebuilt row was written after it; and a bound on its own admits
    // any string that sorts high, "9999" included, so the shape stays too.
    expect(new Set(rebuilt.map((r) => r.role_id)).size).toBe(18);
    expect(
      rebuilt.map((r) => r.created_at).filter((at) => !/^\d{4}-\d{2}-\d{2}T/.test(at))
    ).toEqual([]);
    const newestBefore = snapshot.map((r) => r.created_at).sort()[snapshot.length - 1];
    expect(rebuilt.filter((r) => r.created_at < newestBefore).map((r) => r.created_at)).toEqual([]);
    // Named so a failure says which person, rather than only that two arrays
    // of sixteen rows differ.
    for (const person of [sam, olive, cole, rita, sig, ollie, quinn, quill]) {
      expect(
        comparable(rebuilt.filter((r) => r.canonical_person_id === person.canonical_person_id))
      ).toEqual(
        comparable(snapshot.filter((r) => r.canonical_person_id === person.canonical_person_id))
      );
    }
  });

  it("mints no tenure from a filing carrying no date, and never back-dates one it shares a group with", async () => {
    // EDGAR filings genuinely reach storage with an empty `filing_date` — the
    // forms worklist keeps them deliberately — and the live path's gate is
    // three-part, so such a filing asserts titles and nothing else. The empty
    // string also sorts before every real date, so admitting it would not just
    // mint a tenure the incremental path refuses: it would become the
    // `start_date` of every dated tenure it joins.
    await seedFiling("ACC-BLANK", 720, "");
    await seedFiling("ACC-DATED", 720, "2024-03-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    // One person named by both filings, one named only by the undated one.
    await observeRoleClaim(observer, {
      accession_number: "ACC-BLANK",
      filing_date: "",
      company_cik: 720,
      person_cik: 5601,
      last_name: "Undated",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    await observeRoleClaim(observer, {
      accession_number: "ACC-BLANK",
      filing_date: "",
      company_cik: 720,
      person_cik: 5602,
      last_name: "Blankonly",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 1,
    });
    await observeRoleClaim(observer, {
      accession_number: "ACC-DATED",
      filing_date: "2024-03-01",
      company_cik: 720,
      person_cik: 5601,
      last_name: "Undated",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });

    const snapshot = await allTenures();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].start_date).toBe("2024-03-01");
    expect(snapshot[0].start_accession).toBe("ACC-DATED");

    const result = await rebuildPersonRoles(RESOLVER_VERSION);
    const rebuilt = await allTenures();
    // Compared before the count, so admitting the undated filing reports both
    // damages at once: the tenure it invents and the start it back-dates.
    expect(comparable(rebuilt)).toEqual(comparable(snapshot));
    expect(result).toEqual({ rows: 1 });
    expect(rebuilt[0].start_date).toBe("2024-03-01");
    expect(rebuilt[0].start_accession).toBe("ACC-DATED");
  });

  it("stamps the chronologically first display spelling of a title, not the first processed", async () => {
    // `normalizeRoleTitle` lowercases, so one group can hold two display
    // spellings only where canonicalization is not case-preserving. It is not:
    // `titleCaseWord` raises the first character of an already-lowercased word,
    // and uppercasing is not a round trip for the code points that expand.
    // U+FB01, the "fi" ligature, uppercases to the two characters "FI", so a
    // title spelled with it canonicalizes to "Chief FInancial Officer" while
    // the plain spelling stays "Chief Financial Officer". Both normalize to
    // "chief financial officer", so both land in one tenure. (A title clipped
    // at the 256-character column width is the Unicode-free counterexample:
    // the display clamp keeps a trailing space the normalizer's second `trim`
    // eats.) Ingested newest-first, so the two paths pick different spellings
    // and the projection's rule is the one under test.
    await seedFiling("ACC-LIG-OLD", 722, "2022-01-01");
    await seedFiling("ACC-LIG-NEW", 722, "2023-01-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    const cliff = await observeRoleClaim(observer, {
      accession_number: "ACC-LIG-NEW",
      filing_date: "2023-01-01",
      company_cik: 722,
      person_cik: 5801,
      last_name: "Cliff",
      titles: ["Chief Financial Officer"],
      role_scope: ASSERT_ONLY_SCOPE,
      observation_index: 0,
    });
    await observeRoleClaim(observer, {
      accession_number: "ACC-LIG-OLD",
      filing_date: "2022-01-01",
      company_cik: 722,
      person_cik: 5801,
      last_name: "Cliff",
      titles: ["Chief \ufb01nancial Officer"],
      role_scope: ASSERT_ONLY_SCOPE,
      observation_index: 0,
    });

    const spec = {
      canonical_person_id: cliff.canonical_person_id,
      normalized_title: "chief financial officer",
      role_scope: ASSERT_ONLY_SCOPE,
    };
    const snapshot = await allTenures();
    expect(snapshot).toHaveLength(1);
    // The live path writes `title` only on insert — the back-extension branch
    // spreads the row it widens — so it kept the spelling that arrived first.
    expect(tenureFor(snapshot, spec)?.title).toBe("Chief Financial Officer");
    expect(tenureFor(snapshot, spec)?.start_date).toBe("2022-01-01");

    expect(await rebuildPersonRoles(RESOLVER_VERSION)).toEqual({ rows: 1 });
    const rebuilt = await allTenures();
    // The projection reads the filings in date order and stamps the spelling
    // the earliest one used, which under out-of-order ingest is the other one.
    expect(tenureFor(rebuilt, spec)?.title).toBe("Chief FInancial Officer");
    expect(tenureFor(rebuilt, spec)?.start_date).toBe("2022-01-01");
    expect(tenureFor(rebuilt, spec)?.start_accession).toBe("ACC-LIG-OLD");
    expect(tenureFor(rebuilt, spec)?.last_seen_accession).toBe("ACC-LIG-NEW");
  });

  it("closes from a roster recorded complete and never from one recorded incomplete", async () => {
    // A row the extractor declines — a junk name field, an overlong name, a
    // row under a confidence floor — never reaches `observePerson`, so no
    // observation anywhere records that the filing named that person. The live
    // path refuses to close from such a filing; the projection can only refuse
    // too because the verdict is written down.
    await seedFiling("ACC-R1", 721, "2022-01-01");
    await seedFiling("ACC-R2", 721, "2023-01-01");
    await seedFiling("ACC-R3", 721, "2024-01-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    const alpha = await observeRoleClaim(observer, {
      accession_number: "ACC-R1",
      filing_date: "2022-01-01",
      company_cik: 721,
      person_cik: 5701,
      last_name: "Alpha",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    const beta = await observeRoleClaim(observer, {
      accession_number: "ACC-R1",
      filing_date: "2022-01-01",
      company_cik: 721,
      person_cik: 5702,
      last_name: "Beta",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 1,
    });
    await closeRoster(observer, {
      accession_number: "ACC-R1",
      company_cik: 721,
      filing_date: "2022-01-01",
      role_scope: ROSTER_SCOPE,
    });

    // The next filing names Alpha and one row the extractor dropped as junk.
    // Beta is absent from what was observed, but the roster is partial, so
    // that absence is not evidence Beta left.
    await observeRoleClaim(observer, {
      accession_number: "ACC-R2",
      filing_date: "2023-01-01",
      company_cik: 721,
      person_cik: 5701,
      last_name: "Alpha",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    expect(
      await observer.closeUnassertedPersonRoles({
        accession_number: "ACC-R2",
        extractor_id: EXTRACTOR_ID,
        role_scope: ROSTER_SCOPE,
        company_cik: 721,
        filing_date: "2023-01-01",
        complete: false,
      })
    ).toBe(0);

    // A later filing extracts cleanly and names only Alpha: THAT is Beta's
    // departure, and it is dated from this filing rather than the partial one.
    await observeRoleClaim(observer, {
      accession_number: "ACC-R3",
      filing_date: "2024-01-01",
      company_cik: 721,
      person_cik: 5701,
      last_name: "Alpha",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    expect(
      await closeRoster(observer, {
        accession_number: "ACC-R3",
        company_cik: 721,
        filing_date: "2024-01-01",
        role_scope: ROSTER_SCOPE,
      })
    ).toBe(1);

    // Both verdicts are on disk, including the one that closed nothing —
    // recording only the closures would leave the partial roster looking
    // exactly like a filing nobody ever ran a closure pass for.
    const decisions = await new RoleRosterCompletenessRepo().listForAccessions([
      "ACC-R1",
      "ACC-R2",
      "ACC-R3",
    ]);
    expect(
      decisions
        .map((d) => [d.accession_number, d.complete] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    ).toEqual([
      ["ACC-R1", true],
      ["ACC-R2", false],
      ["ACC-R3", true],
    ]);

    const snapshot = await allTenures();
    expect(snapshot).toHaveLength(2);
    const betaSpec = {
      canonical_person_id: beta.canonical_person_id,
      normalized_title: "director",
      role_scope: ROSTER_SCOPE,
    };
    expect(tenureFor(snapshot, betaSpec)?.end_date).toBe("2024-01-01");
    expect(tenureFor(snapshot, betaSpec)?.end_accession).toBe("ACC-R3");
    expect(
      tenureFor(snapshot, {
        canonical_person_id: alpha.canonical_person_id,
        normalized_title: "director",
        role_scope: ROSTER_SCOPE,
      })?.end_date
    ).toBeNull();

    expect(await rebuildPersonRoles(RESOLVER_VERSION)).toEqual({ rows: 2 });
    const rebuilt = await allTenures();
    expect(comparable(rebuilt)).toEqual(comparable(snapshot));
    expect(tenureFor(rebuilt, betaSpec)?.end_date).toBe("2024-01-01");
    expect(tenureFor(rebuilt, betaSpec)?.end_accession).toBe("ACC-R3");
  });

  it("leaves a merged person's tenure open when the roster asserts them under the alias target", async () => {
    // Closure is alias-aware: a roster that asserts the merge TARGET is not
    // evidence the retired id's holder departed. The projection reads the same
    // alias table rather than closing on the raw canonical id.
    await seedFiling("ACC-X1", 708, "2022-01-01");
    await seedFiling("ACC-X2", 708, "2023-01-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    const before = await observeRoleClaim(observer, {
      accession_number: "ACC-X1",
      filing_date: "2022-01-01",
      company_cik: 708,
      person_cik: 4016,
      last_name: "Merged",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });

    await new CanonicalPersonAliasRepo().add(
      before.canonical_person_id,
      "merge-target-person",
      "test merge",
      "test"
    );

    const after = await observeRoleClaim(observer, {
      accession_number: "ACC-X2",
      filing_date: "2023-01-01",
      company_cik: 708,
      person_cik: 4016,
      last_name: "Merged",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });
    expect(after.canonical_person_id).toBe("merge-target-person");
    await closeRoster(observer, {
      accession_number: "ACC-X2",
      company_cik: 708,
      filing_date: "2023-01-01",
      role_scope: ROSTER_SCOPE,
    });

    const snapshot = await allTenures();
    expect(snapshot).toHaveLength(2);
    expect(
      tenureFor(snapshot, {
        canonical_person_id: before.canonical_person_id,
        normalized_title: "director",
        role_scope: ROSTER_SCOPE,
      })?.end_date
    ).toBeNull();

    expect(await rebuildPersonRoles(RESOLVER_VERSION)).toEqual({ rows: 2 });
    expect(comparable(await allTenures())).toEqual(comparable(snapshot));
  });

  it("is idempotent: a second rebuild with no new observations replaces rather than merges", async () => {
    await seedFiling("ACC-10", 710, "2024-05-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    await observeRoleClaim(observer, {
      accession_number: "ACC-10",
      filing_date: "2024-05-01",
      company_cik: 710,
      person_cik: 5001,
      last_name: "Solo",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });

    const first = await rebuildPersonRoles(RESOLVER_VERSION);
    const firstRows = comparable(await allTenures());
    const second = await rebuildPersonRoles(RESOLVER_VERSION);

    expect(second).toEqual(first);
    expect(first).toEqual({ rows: 1 });
    expect(comparable(await allTenures())).toEqual(firstRows);
  });

  it("replaces rather than merges: re-keying an observation's link drops the stale tenure", async () => {
    // Two rebuilds over unchanged input cannot tell a replace from a merge —
    // both rewrite the same tenure. Moving the identity link between them, as
    // a re-key ceremony would, gives the merge a stale row to leave behind.
    await seedFiling("ACC-20", 711, "2024-08-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    const solo = await observeRoleClaim(observer, {
      accession_number: "ACC-20",
      filing_date: "2024-08-01",
      company_cik: 711,
      person_cik: 5101,
      last_name: "Rekeyed",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });

    await rebuildPersonRoles(RESOLVER_VERSION);
    expect((await allTenures()).map((r) => r.canonical_person_id)).toEqual([
      solo.canonical_person_id,
    ]);

    const reassigned = "reassigned-canonical-person";
    await new PersonIdentityLinkRepo().upsert(solo.observation_id, RESOLVER_VERSION, reassigned);

    expect(await rebuildPersonRoles(RESOLVER_VERSION)).toEqual({ rows: 1 });
    const rebuilt = await allTenures();
    expect(rebuilt.some((r) => r.canonical_person_id === solo.canonical_person_id)).toBe(false);
    expect(rebuilt).toEqual([
      expect.objectContaining({
        canonical_person_id: reassigned,
        normalized_title: "director",
        start_date: "2024-08-01",
        end_date: null,
      }),
    ]);
  });

  it("raises rather than silently skipping when an identity link has no matching observation", async () => {
    // A dangling link should never occur in practice, but it is exactly what a
    // backend id-type mismatch looks like: every lookup misses. Skipping
    // silently would empty the projection and let the purge run with nothing
    // to replace what it deleted.
    await new PersonIdentityLinkRepo().upsert(999999, RESOLVER_VERSION, "orphan-canonical-person");

    await expect(rebuildPersonRoles(RESOLVER_VERSION)).rejects.toThrow(/no matching observation/);
  });

  it("raises rather than fabricating a date when an observation's filing row is missing", async () => {
    // One join further along: the observation is there, the filing it cites is
    // not, so there is no date to anchor a tenure to.
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    await observeRoleClaim(observer, {
      // Deliberately never passed to `seedFiling`.
      accession_number: "ACC-NO-FILING",
      filing_date: "2024-04-04",
      company_cik: 712,
      person_cik: 5201,
      last_name: "Nofiling",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });

    await expect(rebuildPersonRoles(RESOLVER_VERSION)).rejects.toThrow(
      /no filing found for accession_number "ACC-NO-FILING"/
    );
  });

  it("purges only its own resolver version, leaving a previous generation's rows intact", async () => {
    // `dropPrevious` retires a generation while the active one serves the
    // current views, so a rebuild must leave every other version alone.
    await seedFiling("ACC-30", 713, "2024-09-01");
    await new PersonRoleRepo().recordAssertion({
      canonical_person_id: "previous-canonical-person",
      resolver_version: PREVIOUS_RESOLVER_VERSION,
      company_cik: 713,
      extractor_id: EXTRACTOR_ID,
      role_scope: ROSTER_SCOPE,
      title: "Director",
      filing_date: "2023-01-01",
      accession_number: "ACC-29",
    });
    const previous = (await allTenures()).filter(
      (r) => r.resolver_version === PREVIOUS_RESOLVER_VERSION
    );
    expect(previous).toHaveLength(1);

    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    await observeRoleClaim(observer, {
      accession_number: "ACC-30",
      filing_date: "2024-09-01",
      company_cik: 713,
      person_cik: 5301,
      last_name: "Active",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });

    expect(await rebuildPersonRoles(RESOLVER_VERSION)).toEqual({ rows: 1 });

    const rows = await allTenures();
    // The retired generation survives byte for byte — same surrogate key, same
    // created_at, not recomputed and not deleted.
    expect(rows.filter((r) => r.resolver_version === PREVIOUS_RESOLVER_VERSION)).toEqual(previous);
    expect(rows.filter((r) => r.resolver_version === RESOLVER_VERSION)).toHaveLength(1);
  });

  it("purges the resolver version's tenures even when the projection computes nothing", async () => {
    // Skipping the purge for an empty projection reads as defensive and would
    // strand a version's rows forever once a reap took its last observation —
    // exactly the case where no later write comes along to overwrite them.
    await seedFiling("ACC-40", 714, "2024-10-01");
    const observer = buildEntityObserver({
      activeResolverPersonVersion: RESOLVER_VERSION,
      activeResolverCompanyVersion: RESOLVER_VERSION,
    });
    const reaped = await observeRoleClaim(observer, {
      accession_number: "ACC-40",
      filing_date: "2024-10-01",
      company_cik: 714,
      person_cik: 5401,
      last_name: "Reaped",
      titles: ["Director"],
      role_scope: ROSTER_SCOPE,
      observation_index: 0,
    });

    expect(await rebuildPersonRoles(RESOLVER_VERSION)).toEqual({ rows: 1 });
    expect(await allTenures()).toHaveLength(1);

    await reapObservation(reaped.observation_id);

    expect(await rebuildPersonRoles(RESOLVER_VERSION)).toEqual({ rows: 0 });
    expect((await allTenures()).filter((r) => r.resolver_version === RESOLVER_VERSION)).toEqual([]);
  });
});
