/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { CanonicalPersonAliasRepo } from "../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalPersonRepo } from "../storage/canonical/CanonicalPersonRepo";
import type { CanonicalPerson } from "../storage/canonical/CanonicalPersonSchema";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import type { PersonIdentityLink } from "../storage/canonical/PersonIdentityLinkSchema";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { ResolveObservationsTask } from "../task/resolve/ResolveObservationsTask";
import { buildObserveOnlyEntityObserver } from "./buildObserveOnlyEntityObserver";
import type { ObservationResult, ObserveOnlyEntityObserver } from "./EntityObserver";
import { labelCanonicalIds, readInlinePathRows } from "./testing/inlinePathFixture";

const RESOLVER_VERSION = "1.0.0";

const EXTRACTOR_ID = "D";

/**
 * The link columns compared across runs. `created_at` is the wall clock at
 * write time — every pass writes its own — so it is compared separately for
 * shape and for being no older than the last thing the previous pass wrote.
 */
type ComparableLink = Omit<PersonIdentityLink, "created_at">;

/** The canonical columns a recorded set can carry; see {@link comparableCanonicals}. */
type ComparableCanonical = Omit<CanonicalPerson, "created_at">;

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

/**
 * One person named by one filing, recorded as the extraction runs. The
 * observer holds no resolver tier, so this yields an observation id and
 * nothing else — a canonical id exists only once the batch pass has run.
 */
async function observe(
  observer: ObserveOnlyEntityObserver,
  spec: {
    readonly accession_number: string;
    readonly observation_index: number;
    readonly issuer_cik: number | null;
    readonly person_cik: number | null;
    readonly first_name: string;
    readonly last_name: string;
    readonly middle_name?: string;
    readonly suffix?: string;
  }
): Promise<ObservationResult> {
  return await observer.observePerson({
    accession_number: spec.accession_number,
    extractor_id: EXTRACTOR_ID,
    extractor_version: "1.0.0",
    observation_index: spec.observation_index,
    source_filing_issuer_cik: spec.issuer_cik,
    cik: spec.person_cik,
    first_name: spec.first_name,
    middle_name: spec.middle_name ?? null,
    last_name: spec.last_name,
    suffix: spec.suffix ?? null,
  });
}

async function allLinks(): Promise<PersonIdentityLink[]> {
  return await new PersonIdentityLinkRepo().listAll();
}

async function allCanonicals(): Promise<CanonicalPerson[]> {
  return await new CanonicalPersonRepo().listAll();
}

/** Every link column but the timestamp, in a stable order. */
function comparableLinks(rows: readonly PersonIdentityLink[]): ComparableLink[] {
  return rows
    .map(({ created_at, ...rest }) => rest)
    .sort(
      (a, b) =>
        a.observation_id - b.observation_id || (a.resolver_version < b.resolver_version ? -1 : 1)
    );
}

/**
 * Canonical rows compare WHOLE, `created_at` included, whenever both sides
 * come from this run. A canonical row is minted once and only re-found
 * afterwards, so a rewritten stamp is itself a difference worth failing on.
 */
function sortedCanonicals(rows: readonly CanonicalPerson[]): CanonicalPerson[] {
  return [...rows].sort((a, b) =>
    a.canonical_person_id < b.canonical_person_id
      ? -1
      : a.canonical_person_id > b.canonical_person_id
        ? 1
        : 0
  );
}

/**
 * The canonical columns a RECORDED set can carry: `created_at` is dropped,
 * since a stamp taken on the day the rows were recorded cannot survive into a
 * later run.
 */
function comparableCanonicals(rows: readonly CanonicalPerson[]): ComparableCanonical[] {
  return sortedCanonicals(rows).map(({ created_at, ...rest }) => rest);
}

function canonicalFor(links: readonly PersonIdentityLink[], observation_id: number): string {
  const found = links.find((link) => link.observation_id === observation_id);
  if (found === undefined) throw new Error(`no identity link for observation ${observation_id}`);
  return found.canonical_person_id;
}

function canonicalRow(
  rows: readonly CanonicalPerson[],
  canonical_person_id: string
): CanonicalPerson {
  const found = rows.find((row) => row.canonical_person_id === canonical_person_id);
  if (found === undefined) throw new Error(`no canonical_person row ${canonical_person_id}`);
  return found;
}

/** The batch pass, run the way the CLI runs it. */
async function reresolve(): Promise<{ count: number; skipped: number }> {
  const output = await new ResolveObservationsTask({
    defaults: { kind: "person", resolverVersion: RESOLVER_VERSION },
  }).run();
  return { count: output.count, skipped: output.skipped };
}

describe("re-resolving person observations", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("reproduces the recorded incremental path's identity links and canonical rows exactly — one person under two issuers, a name split by issuer and by suffix, a CIK that arrives late, and a merged pair", async () => {
    for (const [accession, cik, date] of [
      ["ACC-1", 8001, "2024-01-05"],
      ["ACC-2", 8001, "2024-02-05"],
      ["ACC-3", 8002, "2024-03-05"],
      ["ACC-4", 8002, "2024-04-05"],
      ["ACC-5", 8003, "2024-05-05"],
      ["ACC-6", 8003, "2024-06-05"],
    ] as const) {
      await seedFiling(accession, cik, date);
    }

    const observer = buildObserveOnlyEntityObserver();

    // --- ACC-1, issuer 8001 ---
    // Ada carries her own CIK, so she is CIK-keyed and the issuer plays no
    // part; the row is stamped from THIS observation and never re-derived.
    const adaFirst = await observe(observer, {
      accession_number: "ACC-1",
      observation_index: 0,
      issuer_cik: 8001,
      person_cik: 6001,
      first_name: "Ada",
      last_name: "Multi",
    });
    // Nora carries none, so she is keyed on the normalized name parts plus
    // the issuer.
    const noraOne = await observe(observer, {
      accession_number: "ACC-1",
      observation_index: 1,
      issuer_cik: 8001,
      person_cik: null,
      first_name: "Nora",
      last_name: "Nocik",
    });
    // The same name and issuer with a generational suffix is a different
    // person: `normalized_suffix` is part of the name key.
    const noraJunior = await observe(observer, {
      accession_number: "ACC-1",
      observation_index: 2,
      issuer_cik: 8001,
      person_cik: null,
      first_name: "Nora",
      last_name: "Nocik",
      suffix: "Jr.",
    });
    // Cliff, first sighting, with no CIK of his own.
    const cliffNoCik = await observe(observer, {
      accession_number: "ACC-1",
      observation_index: 3,
      issuer_cik: 8001,
      person_cik: null,
      first_name: "Cliff",
      last_name: "Latecik",
    });

    // --- ACC-2, the same issuer ---
    // The same name and issuer again: one canonical, two observations.
    const noraTwo = await observe(observer, {
      accession_number: "ACC-2",
      observation_index: 0,
      issuer_cik: 8001,
      person_cik: null,
      first_name: "Nora",
      last_name: "Nocik",
    });
    // Cliff again, same name and same issuer, but this filing supplies his
    // CIK. `personKey` takes the CIK branch, which no name-keyed row can
    // satisfy, so this mints a SECOND canonical for one human being. Nothing
    // merges them.
    const cliffWithCik = await observe(observer, {
      accession_number: "ACC-2",
      observation_index: 1,
      issuer_cik: 8001,
      person_cik: 6002,
      first_name: "Cliff",
      last_name: "Latecik",
    });

    // --- ACC-3, a different issuer ---
    // Ada under a second issuer, and spelled differently. The CIK branch
    // finds her existing row; "Adelaide Multi" and "Ada Multi" are equally
    // complete, and an equal-quality display name does not displace the
    // incumbent, so the name stays the one ACC-1 filed.
    const adaOtherIssuer = await observe(observer, {
      accession_number: "ACC-3",
      observation_index: 0,
      issuer_cik: 8002,
      person_cik: 6001,
      first_name: "Adelaide",
      last_name: "Multi",
    });
    // Nora's name under a different issuer is a different canonical — the
    // name key is scoped to one issuer precisely so two filers' namesakes do
    // not collide.
    const noraOtherIssuer = await observe(observer, {
      accession_number: "ACC-3",
      observation_index: 1,
      issuer_cik: 8002,
      person_cik: null,
      first_name: "Nora",
      last_name: "Nocik",
    });
    // Pat is the mirror of Cliff: the CIK arrives FIRST.
    const patWithCik = await observe(observer, {
      accession_number: "ACC-3",
      observation_index: 2,
      issuer_cik: 8002,
      person_cik: 6005,
      first_name: "Pat",
      last_name: "Priorcik",
    });

    // --- ACC-4, the same issuer as ACC-3 ---
    // Pat again with no CIK. A CIK-keyed row is stamped with a NULL
    // `source_filing_issuer_cik`, so the name lookup — which matches that
    // column — cannot reach it, and this mints a second canonical.
    const patNoCik = await observe(observer, {
      accession_number: "ACC-4",
      observation_index: 0,
      issuer_cik: 8002,
      person_cik: null,
      first_name: "Pat",
      last_name: "Priorcik",
    });
    // Pat once more, from an extractor that records no issuer either. Now
    // BOTH null columns line up with the CIK-keyed row, so the name lookup
    // does reach it: this observation joins the CIK-keyed canonical rather
    // than the name-keyed one its named-issuer sibling minted.
    const patNoIssuer = await observe(observer, {
      accession_number: "ACC-4",
      observation_index: 1,
      issuer_cik: null,
      person_cik: null,
      first_name: "Pat",
      last_name: "Priorcik",
    });

    // --- ACC-5 / ACC-6: one human filing under two CIKs, merged below ---
    const danaFirstCik = await observe(observer, {
      accession_number: "ACC-5",
      observation_index: 0,
      issuer_cik: 8003,
      person_cik: 6003,
      first_name: "Dana",
      last_name: "Dual",
    });
    const danaSecondCik = await observe(observer, {
      accession_number: "ACC-6",
      observation_index: 0,
      issuer_cik: 8003,
      person_cik: 6004,
      first_name: "Dana",
      last_name: "Dual",
    });
    // Recording is all that has happened: an observer with no resolver tier
    // writes observations and their titles, so every link and canonical row
    // below is this pass's own output rather than something it inherited.
    expect(await allLinks()).toEqual([]);
    expect(await allCanonicals()).toEqual([]);

    expect(await reresolve()).toEqual({ count: 13, skipped: 0 });
    const firstPass = await allLinks();

    // Two CIKs, one human. The CIK branch mints one canonical each and nothing
    // in the tier merges them, so the merge is an operator act recorded as an
    // alias — and the alias is applied inside `resolve`, so the next pass
    // re-points the retired id's links at the survivor.
    const retiredDanaId = canonicalFor(firstPass, danaFirstCik.observation_id);
    const survivingDanaId = canonicalFor(firstPass, danaSecondCik.observation_id);
    expect(retiredDanaId).not.toBe(survivingDanaId);
    await new CanonicalPersonAliasRepo().add(
      retiredDanaId,
      survivingDanaId,
      "merged duplicate",
      "test"
    );

    // --- re-extractions, arriving after the corpus has been resolved once ---
    // A filing already ingested, extracted again. It upserts the observation
    // row it wrote the first time rather than adding one, which is why fifteen
    // claims leave thirteen observations for the pass to resolve.
    await observe(observer, {
      accession_number: "ACC-5",
      observation_index: 0,
      issuer_cik: 8003,
      person_cik: 6003,
      first_name: "Dana",
      last_name: "Dual",
    });
    // A re-extraction of the FIRST filing, arriving last and carrying a middle
    // name the original claim did not. Ada's canonical was minted by the pass
    // above, before this reading of her name existed, so the pass below
    // re-FINDS her row: the ranked display columns take the fuller name, and
    // the identity columns keep the mint's reading. The observation keeps the
    // `observation_id` it was assigned, so the order the claims arrived in and
    // the pass's own accession order disagree — which is what stops an
    // agreement between them being an artefact of one order.
    await observe(observer, {
      accession_number: "ACC-1",
      observation_index: 0,
      issuer_cik: 8001,
      person_cik: 6001,
      first_name: "Ada",
      middle_name: "M.",
      last_name: "Multi",
    });

    expect(await reresolve()).toEqual({ count: 13, skipped: 0 });

    const links = await allLinks();
    const canonicals = await allCanonicals();

    // The pass's own outcome, pinned before it is compared to anything — an
    // equality against an empty or accidental snapshot proves nothing.
    expect(links).toHaveLength(13);
    expect(links.every((link) => link.resolver_version === RESOLVER_VERSION)).toBe(true);
    expect(new Set(links.map((link) => link.canonical_person_id)).size).toBe(9);
    expect(canonicals).toHaveLength(10);

    // One canonical across two issuers, because the CIK branch never consults
    // the issuer.
    expect(canonicalFor(links, adaFirst.observation_id)).toBe(
      canonicalFor(links, adaOtherIssuer.observation_id)
    );
    // Same name and issuer, twice, is one canonical.
    expect(canonicalFor(links, noraOne.observation_id)).toBe(
      canonicalFor(links, noraTwo.observation_id)
    );
    // The issuer and the suffix each split it.
    expect(canonicalFor(links, noraOtherIssuer.observation_id)).not.toBe(
      canonicalFor(links, noraOne.observation_id)
    );
    expect(canonicalFor(links, noraJunior.observation_id)).not.toBe(
      canonicalFor(links, noraOne.observation_id)
    );
    // The late CIK, and its mirror: two canonicals per human, both ways round.
    expect(canonicalFor(links, cliffWithCik.observation_id)).not.toBe(
      canonicalFor(links, cliffNoCik.observation_id)
    );
    expect(canonicalFor(links, patNoCik.observation_id)).not.toBe(
      canonicalFor(links, patWithCik.observation_id)
    );
    // …except when the later observation records no issuer either.
    expect(canonicalFor(links, patNoIssuer.observation_id)).toBe(
      canonicalFor(links, patWithCik.observation_id)
    );
    // The merge: both CIKs' observations land on the surviving id, and the
    // retired one is left with a canonical row and no links.
    expect(canonicalFor(links, danaFirstCik.observation_id)).toBe(
      canonicalFor(links, danaSecondCik.observation_id)
    );
    expect(links.some((link) => link.canonical_person_id === retiredDanaId)).toBe(false);
    expect(canonicals.some((row) => row.canonical_person_id === retiredDanaId)).toBe(true);

    // The stamped columns, pinned per row. `display_middle` comes from the
    // re-extraction of ACC-1, which is the only observation to supply a middle
    // name: display fields are ranked, so a more complete name upgrades them
    // rather than the mint owning them forever. The identity columns below are
    // NOT ranked — those the mint does own, which is why `normalized_middle`
    // stays null on a row whose display name now spells the middle out.
    const adaRow = canonicalRow(canonicals, canonicalFor(links, adaFirst.observation_id));
    expect(adaRow.display_first).toBe("Ada");
    expect(adaRow.display_middle).toBe("M.");
    expect(adaRow.display_last).toBe("Multi");
    expect(adaRow.normalized_middle).toBeNull();
    expect(adaRow.cik).toBe(6001);
    expect(adaRow.source_filing_issuer_cik).toBeNull();

    const noraRow = canonicalRow(canonicals, canonicalFor(links, noraOne.observation_id));
    expect(noraRow.cik).toBeNull();
    expect(noraRow.source_filing_issuer_cik).toBe(8001);
    expect(noraRow.normalized_last).toBe("Nocik");
    expect(noraRow.normalized_suffix).toBeNull();

    const noraJuniorRow = canonicalRow(canonicals, canonicalFor(links, noraJunior.observation_id));
    expect(noraJuniorRow.source_filing_issuer_cik).toBe(8001);
    expect(noraJuniorRow.normalized_suffix).toBe("Jr");

    expect(
      canonicalRow(canonicals, canonicalFor(links, noraOtherIssuer.observation_id))
        .source_filing_issuer_cik
    ).toBe(8002);

    const cliffNameRow = canonicalRow(canonicals, canonicalFor(links, cliffNoCik.observation_id));
    expect(cliffNameRow.cik).toBeNull();
    expect(cliffNameRow.source_filing_issuer_cik).toBe(8001);
    const cliffCikRow = canonicalRow(canonicals, canonicalFor(links, cliffWithCik.observation_id));
    expect(cliffCikRow.cik).toBe(6002);
    expect(cliffCikRow.source_filing_issuer_cik).toBeNull();

    const patCikRow = canonicalRow(canonicals, canonicalFor(links, patWithCik.observation_id));
    expect(patCikRow.cik).toBe(6005);
    expect(patCikRow.source_filing_issuer_cik).toBeNull();
    const patNameRow = canonicalRow(canonicals, canonicalFor(links, patNoCik.observation_id));
    expect(patNameRow.cik).toBeNull();
    expect(patNameRow.source_filing_issuer_cik).toBe(8002);

    // What the incrementally maintained tables held for this exact scenario,
    // recorded from that path before it was deleted. Labelled the way those
    // rows were, so a freshly minted canonical id still compares: this asserts
    // the partition — who shares an identity with whom — and every other
    // column of every row at once.
    expect(labelCanonicalIds(comparableLinks(links), "canonical_person_id")).toEqual(
      readInlinePathRows<ComparableLink>("links-multi-issuer")
    );
    expect(labelCanonicalIds(comparableCanonicals(canonicals), "canonical_person_id")).toEqual(
      readInlinePathRows<ComparableCanonical>("canonicals-multi-issuer")
    );

    // `created_at` on a link is the one column a re-run legitimately rewrites,
    // so it is bounded rather than skipped: the merge pass had to write all
    // thirteen, not leave the first pass's rows where they lay. Both halves
    // are needed — a shape check cannot tell a fresh stamp from one carried
    // off the earlier row, and a bound on its own admits any string that sorts
    // high.
    expect(
      links.map((link) => link.created_at).filter((at) => !/^\d{4}-\d{2}-\d{2}T/.test(at))
    ).toEqual([]);
    const newestBefore = firstPass.map((link) => link.created_at).sort()[firstPass.length - 1];
    expect(
      links.filter((link) => link.created_at < newestBefore).map((link) => link.created_at)
    ).toEqual([]);

    // None of the above proves the pass WROTE these rows rather than leaving
    // the ones already there untouched — an upsert of an identical value is
    // invisible, and the timestamps only separate two passes while the clock
    // happens to tick between them. Purging the version's links and running it
    // again asks for all thirteen from nothing, which is also the ceremony
    // `drop-previous` leans on: it removes the links and this pass is what
    // rebuilds them.
    expect(await new PersonIdentityLinkRepo().deleteForResolverVersion(RESOLVER_VERSION)).toBe(13);
    expect(await allLinks()).toEqual([]);
    expect(await reresolve()).toEqual({ count: 13, skipped: 0 });
    const fromNothing = await allLinks();
    expect(comparableLinks(fromNothing)).toEqual(comparableLinks(links));
    // And still no canonical row minted, dropped or restamped along the way.
    expect(sortedCanonicals(await allCanonicals())).toEqual(sortedCanonicals(canonicals));

    // Named so a failure says which person moved, rather than only that two
    // arrays of thirteen rows differ.
    for (const person of [
      adaFirst,
      noraOne,
      noraJunior,
      noraOtherIssuer,
      cliffNoCik,
      cliffWithCik,
      patWithCik,
      patNoCik,
      danaSecondCik,
    ]) {
      const id = canonicalFor(links, person.observation_id);
      expect(
        comparableLinks(fromNothing.filter((link) => link.canonical_person_id === id))
      ).toEqual(comparableLinks(links.filter((link) => link.canonical_person_id === id)));
    }
  });

  it("splits a person first observed without a CIK and later with one into two canonicals, and the batch pass reproduces the split rather than merging or re-minting", async () => {
    // The case `personKey` makes reachable and nothing else in the tier
    // repairs: the CIK branch and the name branch are separate key spaces, so
    // the second sighting cannot find what the first minted. The pass reads
    // that same `personKey` over stored observations, so recomputing the whole
    // corpus at once is not a second chance to merge them.
    await seedFiling("ACC-EARLY", 8100, "2024-01-01");
    await seedFiling("ACC-LATE", 8100, "2024-07-01");

    const observer = buildObserveOnlyEntityObserver();
    const before = await observe(observer, {
      accession_number: "ACC-EARLY",
      observation_index: 0,
      issuer_cik: 8100,
      person_cik: null,
      first_name: "Cliff",
      last_name: "Latecik",
    });
    const after = await observe(observer, {
      accession_number: "ACC-LATE",
      observation_index: 0,
      issuer_cik: 8100,
      person_cik: 6100,
      first_name: "Cliff",
      last_name: "Latecik",
    });

    expect(await allLinks()).toEqual([]);
    expect(await allCanonicals()).toEqual([]);

    expect(await reresolve()).toEqual({ count: 2, skipped: 0 });

    const links = await allLinks();
    const canonicals = await allCanonicals();
    expect(links).toHaveLength(2);
    expect(canonicals).toHaveLength(2);
    const beforeId = canonicalFor(links, before.observation_id);
    const afterId = canonicalFor(links, after.observation_id);
    expect(beforeId).not.toBe(afterId);
    expect(canonicalRow(canonicals, beforeId).cik).toBeNull();
    expect(canonicalRow(canonicals, beforeId).source_filing_issuer_cik).toBe(8100);
    expect(canonicalRow(canonicals, afterId).cik).toBe(6100);
    expect(canonicalRow(canonicals, afterId).source_filing_issuer_cik).toBeNull();

    // The rows the incremental path held for this scenario, recorded before it
    // was deleted and labelled the same way.
    expect(labelCanonicalIds(comparableLinks(links), "canonical_person_id")).toEqual(
      readInlinePathRows<ComparableLink>("links-late-cik")
    );
    expect(labelCanonicalIds(comparableCanonicals(canonicals), "canonical_person_id")).toEqual(
      readInlinePathRows<ComparableCanonical>("canonicals-late-cik")
    );

    // Again from nothing, so the equalities above cannot pass on a pass that
    // wrote no link at all.
    expect(await new PersonIdentityLinkRepo().deleteForResolverVersion(RESOLVER_VERSION)).toBe(2);
    expect(await reresolve()).toEqual({ count: 2, skipped: 0 });
    const fromNothing = await allLinks();
    expect(comparableLinks(fromNothing)).toEqual(comparableLinks(links));
    expect(sortedCanonicals(await allCanonicals())).toEqual(sortedCanonicals(canonicals));
    // Said again against the named ids, so a failure distinguishes the two
    // ways this can go wrong: the pair merged, or a third canonical minted.
    expect(canonicalFor(fromNothing, before.observation_id)).toBe(beforeId);
    expect(canonicalFor(fromNothing, after.observation_id)).toBe(afterId);
  });
});
