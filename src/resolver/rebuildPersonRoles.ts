/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CanonicalPersonAliasRepo } from "../storage/canonical/CanonicalPersonAliasRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import {
  PersonRoleRepo,
  normalizeRoleTitle,
  personRoleAssertionKey,
} from "../storage/canonical/PersonRoleRepo";
import { RoleRosterCompletenessRepo } from "../storage/canonical/RoleRosterCompletenessRepo";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { PersonObservationTitleRepo } from "../storage/observation/PersonObservationTitleRepo";
import type { PersonObservation } from "../storage/observation/PersonObservationSchema";
import { canonicalRoleTitles } from "./EntityObserver";
import { writePersonRoleSnapshot } from "./personRoleSnapshot";
import { loadFilingDates } from "./rebuildFilingDates";
import { isCompleteRosterRoleScope } from "./roleScopes";

/** One filing's assertion of one title, as the tenure walk consumes it. */
interface RoleAssertion {
  readonly filing_date: string;
  readonly accession_number: string;
  /** Canonical display title, as this filing spelled it. */
  readonly title: string;
}

/** One filing's contribution to a `(extractor_id, role_scope, company_cik)` roster. */
interface RosterFiling {
  readonly accession_number: string;
  readonly filing_date: string;
  /** {@link personRoleAssertionKey} for every (person, title) this filing asserts. */
  readonly asserted: Set<string>;
  /**
   * A person this filing names contributed no canonical title, so its roster
   * is not the complete list of role holders and closing from it would record
   * departures the filing never evidenced.
   */
  incomplete: boolean;
}

interface Roster {
  readonly extractor_id: string;
  readonly role_scope: string;
  readonly company_cik: number;
  readonly filings: Map<string, RosterFiling>;
}

/** Every assertion of one `(person, company, extractor, scope, title)`. */
interface TenureGroup {
  readonly canonical_person_id: string;
  readonly company_cik: number;
  readonly extractor_id: string;
  readonly role_scope: string;
  readonly normalized_title: string;
  readonly rosterKey: string;
  readonly assertions: RoleAssertion[];
}

/** One computed tenure: its opening and closing evidence. */
interface Tenure {
  readonly start: RoleAssertion;
  readonly last: RoleAssertion;
  readonly closedBy: RosterFiling | undefined;
}

/**
 * Chronological, then by accession so filings sharing a date order the same
 * way on every run. The incremental path resolves such a tie by processing
 * order instead, which no stored column records.
 */
function byFilingOrder(
  a: { readonly filing_date: string; readonly accession_number: string },
  b: { readonly filing_date: string; readonly accession_number: string }
): number {
  if (a.filing_date !== b.filing_date) return a.filing_date < b.filing_date ? -1 : 1;
  return a.accession_number < b.accession_number
    ? -1
    : a.accession_number > b.accession_number
      ? 1
      : 0;
}

/**
 * The asserting filing's date for one observation. A tenure IS a pair of
 * filing dates, so an observation whose filing row is missing has nothing to
 * anchor one to — raising surfaces that corruption rather than dating a
 * tenure from nothing.
 */
function filingDateFor(byAccession: ReadonlyMap<string, string>, accession_number: string): string {
  const filing_date = byAccession.get(accession_number);
  if (filing_date === undefined) {
    throw new Error(
      `rebuildPersonRoles: no filing found for accession_number ${JSON.stringify(accession_number)}`
    );
  }
  return filing_date;
}

/**
 * The observation a link points to. A miss here is never "this observation
 * just isn't part of the rebuild" — every live link has a backing observation
 * row, since removing one always removes the other (see
 * `reapStaleObservations`). It means either a dangling link left behind by a
 * bug, or the backend handed `observation_id` back as a type that does not
 * `===`-match what the link stored (a widened Postgres integer, a
 * safe-integers SQLite handle, a proxied storage) — and here it would miss on
 * EVERY link at once, so raising is the only safe response: silently skipping
 * would leave the projection empty, and the purge would then delete the
 * resolver version's tenures and write none back.
 */
function observationFor(
  byId: ReadonlyMap<number, PersonObservation>,
  observation_id: number
): PersonObservation {
  const observation = byId.get(observation_id);
  if (observation === undefined) {
    throw new Error(
      `rebuildPersonRoles: identity link references observation_id ` +
        `${JSON.stringify(observation_id)} (${typeof observation_id}) with no matching ` +
        `observation row — dangling link, or a backend id-type mismatch?`
    );
  }
  return observation;
}

/**
 * The titles filed for one observation. `listForObservations` gives every
 * requested id an entry (empty when the observation has no title rows), so a
 * miss means the map was keyed by something other than the id asked for.
 */
function titlesFor(byId: ReadonlyMap<number, string[]>, observation_id: number): readonly string[] {
  const titles = byId.get(observation_id);
  if (titles === undefined) {
    throw new Error(
      `rebuildPersonRoles: no title lookup entry for observation_id ` +
        `${JSON.stringify(observation_id)} (${typeof observation_id}) — backend id-type mismatch?`
    );
  }
  return titles;
}

function rosterKeyOf(extractor_id: string, role_scope: string, company_cik: number): string {
  return `${extractor_id}\x00${role_scope}\x00${company_cik}`;
}

/** The tuple one roster completeness decision is recorded against. */
function rosterCompletenessKey(
  accession_number: string,
  extractor_id: string,
  role_scope: string,
  company_cik: number
): string {
  return `${accession_number}\x00${extractor_id}\x00${role_scope}\x00${company_cik}`;
}

/**
 * The rosters recorded COMPLETE, as {@link rosterCompletenessKey} keys. A
 * roster with no row at all — every filing processed before the decision was
 * written down — is absent, and absence reads as "not known to be complete":
 * it closes nothing.
 */
async function loadCompleteRosters(
  accession_numbers: readonly string[]
): Promise<ReadonlySet<string>> {
  const rows = await new RoleRosterCompletenessRepo().listForAccessions(accession_numbers);
  const complete = new Set<string>();
  for (const row of rows) {
    if (!row.complete) continue;
    complete.add(
      rosterCompletenessKey(row.accession_number, row.extractor_id, row.role_scope, row.company_cik)
    );
  }
  return complete;
}

/**
 * The filings of one roster that may end a tenure. Three things must hold, and
 * they come from three different places: the scope is one whose filings name
 * everyone; the extraction that fed the filing recorded itself as having read
 * the whole roster; and every person the filing names contributed a canonical
 * title. Only the last is derivable here — a filing enters a roster only
 * through a person observed in it, so one that asserts nobody is one every
 * person it names contributed no title to, and that is no evidence anybody
 * left.
 */
function closingFilings(roster: Roster, completeRosters: ReadonlySet<string>): RosterFiling[] {
  if (!isCompleteRosterRoleScope(roster.role_scope)) return [];
  return [...roster.filings.values()]
    .filter(
      (filing) =>
        !filing.incomplete &&
        completeRosters.has(
          rosterCompletenessKey(
            filing.accession_number,
            roster.extractor_id,
            roster.role_scope,
            roster.company_cik
          )
        )
    )
    .sort(byFilingOrder);
}

/**
 * Splits one group's assertions into tenures. A tenure runs from its earliest
 * assertion to its latest, and ends at the earliest closing filing dated
 * strictly after that latest assertion — strictly, so a same-day roster never
 * closes what its sibling filing asserts. An assertion dated after such a
 * closure is a return, and opens another tenure.
 */
function walkTenures(
  assertions: readonly RoleAssertion[],
  closers: readonly RosterFiling[]
): Tenure[] {
  const ordered = [...assertions].sort(byFilingOrder);
  const tenures: Tenure[] = [];
  let index = 0;
  while (index < ordered.length) {
    const start = ordered[index];
    let last = start;
    let next = index + 1;
    let closedBy: RosterFiling | undefined;
    for (;;) {
      closedBy = closers.find((filing) => filing.filing_date > last.filing_date);
      const following = ordered[next];
      if (
        following !== undefined &&
        (closedBy === undefined || following.filing_date <= closedBy.filing_date)
      ) {
        last = following;
        next += 1;
        continue;
      }
      break;
    }
    tenures.push({ start, last, closedBy });
    index = next;
  }
  return tenures;
}

/**
 * Recomputes every `person_role` tenure at `resolverVersion` from the current
 * person observations and their identity links, and replaces the resolver
 * version's rows outright.
 *
 * This is a projection, not a replay of `EntityObserver`'s incremental
 * assertion bookkeeping. A tenure's dates are a function of two things both
 * recorded on disk: which filings assert a (canonical person, company, title)
 * at a `role_scope`, and which complete-roster filings for that same scope do
 * not. Grouping the current observations therefore reproduces the tenure a
 * running ingestion would have left, with no dependence on what any row held
 * before — the same result however many times it runs, and the same result
 * whether the resolver ran during ingestion or long after it.
 *
 * Three things it cannot reproduce:
 *
 * - Which of two filings sharing a date was processed second. The projection
 *   breaks such ties by accession number; the incremental path records
 *   whichever landed last.
 * - Which display spelling a tenure's `title` carries when one group's
 *   assertions disagree about it. The projection stamps the chronologically
 *   first assertion's spelling; the live path writes `title` only on insert, so
 *   it stamps the first-PROCESSED one. The two coincide unless a group holds
 *   more than one spelling, which is narrow: `normalizeRoleTitle` groups
 *   case- and whitespace-insensitively, so it takes either a character whose
 *   uppercasing expands — `titleCaseWord` raises U+FB01 (the "fi" ligature) to
 *   the two characters "FI", and "ß" to "SS", leaving a display form the same
 *   title spelled plainly never produces — or a title clipped at the
 *   256-character column width, where the display clamp keeps a trailing space
 *   the normalizer's second `trim` eats. Narrow, not absent, and out-of-order
 *   ingest is then enough to diverge.
 * - An observation whose accession has no `filings` row: it raises rather than
 *   dating a tenure from nothing. The live path tolerates that filing (it
 *   yields an empty date, which its own gate then skips), so one dangling
 *   accession anywhere aborts a whole-version rebuild. Whether a corpus-scale
 *   pass should abort or skip-and-count is a decision for whatever task wires
 *   this up, and is deliberately not taken here — the raise surfaces the
 *   corruption instead of hiding it.
 *
 * **Both of its inputs are columns older data does not carry, and the purge is
 * unconditional — so a rebuild over a corpus ingested before them destroys
 * tenures rather than declining to add to them.** Re-extract the filings first.
 *
 * - `person_observation.role_scope` is what says which list a person was read
 *   from, and the three-part gate above skips every observation without one.
 *   Rows written before that column existed are all null, so a rebuild over
 *   them derives NO tenures at all — and `deleteForResolverVersion` has already
 *   run, so the version's `person_role` rows are simply gone.
 * - `role_roster_completeness` is what lets a filing end a tenure it does not
 *   assert; roster completeness is read, not derived, because a person the
 *   extractor declined leaves no observation and so no trace of having been
 *   named. Without those rows a rebuild closes nothing, deleting every
 *   `end_date` the incremental path recorded and re-opening every departure the
 *   corpus knew about.
 *
 * The direction of the second error is safe on its own — a missing row
 * under-reports departures rather than inventing them, and it heals as filings
 * are re-extracted. The first is not: it is a whole-table loss, and nothing
 * else can reconstruct those tenures. So the version's rows are written to a
 * file before the purge (see {@link writePersonRoleSnapshot}), which is what
 * makes a rebuild over such a corpus reversible rather than merely regrettable.
 */
export async function rebuildPersonRoles(
  resolverVersion: string
): Promise<{ readonly rows: number }> {
  const linkRepo = new PersonIdentityLinkRepo();
  const observationRepo = new PersonObservationRepo();
  const titleRepo = new PersonObservationTitleRepo();
  const roleRepo = new PersonRoleRepo();

  const links = await linkRepo.listForResolverVersion(resolverVersion);
  const observations = await observationRepo.listByIds(links.map((link) => link.observation_id));
  const observationById = new Map(observations.map((o) => [o.observation_id, o]));
  const titlesById = await titleRepo.listForObservations(observations.map((o) => o.observation_id));
  const filingDates = await loadFilingDates(observations.map((o) => o.accession_number));

  const rosters = new Map<string, Roster>();
  const groups = new Map<string, TenureGroup>();

  for (const link of links) {
    const observation = observationFor(observationById, link.observation_id);
    const filing_date = filingDateFor(filingDates, observation.accession_number);
    const role_scope = observation.role_scope;
    const company_cik = observation.source_filing_issuer_cik;
    // A claim with no date to anchor a tenure to, no scope, or no company to
    // hold the role at records titles and nothing else — the same three-part
    // gate `recordPersonRoles` applies. The date is the one that is not on the
    // observation: filings genuinely carry an empty `filing_date`, and an
    // empty one also sorts before every real date, so admitting it would both
    // mint tenures the live path refuses and back-date the ones it shares a
    // group with.
    if (!filing_date || role_scope == null || company_cik == null) continue;

    const rosterKey = rosterKeyOf(observation.extractor_id, role_scope, company_cik);
    let roster = rosters.get(rosterKey);
    if (roster === undefined) {
      roster = {
        extractor_id: observation.extractor_id,
        role_scope,
        company_cik,
        filings: new Map<string, RosterFiling>(),
      };
      rosters.set(rosterKey, roster);
    }
    let filing = roster.filings.get(observation.accession_number);
    if (filing === undefined) {
      filing = {
        accession_number: observation.accession_number,
        filing_date,
        asserted: new Set<string>(),
        incomplete: false,
      };
      roster.filings.set(observation.accession_number, filing);
    }

    const titles = canonicalRoleTitles(titlesFor(titlesById, observation.observation_id));
    if (titles.length === 0) {
      filing.incomplete = true;
      continue;
    }

    for (const rawTitle of titles) {
      const title = rawTitle.trim().slice(0, 256);
      const normalized_title = normalizeRoleTitle(title);
      filing.asserted.add(personRoleAssertionKey(link.canonical_person_id, normalized_title));

      const groupKey = `${link.canonical_person_id}\x00${rosterKey}\x00${normalized_title}`;
      let group = groups.get(groupKey);
      if (group === undefined) {
        group = {
          canonical_person_id: link.canonical_person_id,
          company_cik,
          extractor_id: observation.extractor_id,
          role_scope,
          normalized_title,
          rosterKey,
          assertions: [],
        };
        groups.set(groupKey, group);
      }
      group.assertions.push({
        filing_date,
        accession_number: observation.accession_number,
        title,
      });
    }
  }

  const completeRosters = await loadCompleteRosters(
    [...rosters.values()].flatMap((roster) => [...roster.filings.keys()])
  );
  const closersByRoster = new Map<string, RosterFiling[]>();
  for (const [rosterKey, roster] of rosters) {
    closersByRoster.set(rosterKey, closingFilings(roster, completeRosters));
  }
  const aliasTargets = await resolveAliasTargets([
    ...new Set([...groups.values()].map((group) => group.canonical_person_id)),
  ]);

  const tenures: { readonly group: TenureGroup; readonly tenure: Tenure }[] = [];
  for (const group of groups.values()) {
    const assertionKey = personRoleAssertionKey(group.canonical_person_id, group.normalized_title);
    // A roster asserting a merged person under the alias target is a
    // continuation, not a departure, so it must not end the retired id's
    // tenure — the same indirection `closeUnasserted` applies.
    const aliasTarget = aliasTargets.get(group.canonical_person_id);
    const aliasKey =
      aliasTarget !== undefined && aliasTarget !== group.canonical_person_id
        ? personRoleAssertionKey(aliasTarget, group.normalized_title)
        : undefined;
    const closers = (closersByRoster.get(group.rosterKey) ?? []).filter(
      (filing) =>
        !filing.asserted.has(assertionKey) &&
        (aliasKey === undefined || !filing.asserted.has(aliasKey))
    );
    for (const tenure of walkTenures(group.assertions, closers)) {
      tenures.push({ group, tenure });
    }
  }

  // Copied out before anything is deleted, because the purge below is the one
  // step of this pass that destroys rather than replaces: what it removes was
  // derived from evidence this pass may no longer be able to read, so the rows
  // themselves are the only record of it. Writing the snapshot FIRST, and
  // letting a failure to write it propagate, is deliberate — a purge whose
  // undo could not be saved is exactly the run this exists for, and raising
  // here leaves the table as it was.
  await writePersonRoleSnapshot(
    resolverVersion,
    await roleRepo.listForResolverVersion(resolverVersion)
  );

  // Unconditional, and scoped: unconditional because a version whose last
  // observation was reaped computes nothing and is exactly the case where no
  // write comes along to overwrite a stale row; scoped because `dropPrevious`
  // and the `current_canonical_*` views depend on other generations surviving.
  await roleRepo.deleteForResolverVersion(resolverVersion);

  for (const { group, tenure } of tenures) {
    await roleRepo.insertTenure({
      canonical_person_id: group.canonical_person_id,
      resolver_version: resolverVersion,
      company_cik: group.company_cik,
      extractor_id: group.extractor_id,
      role_scope: group.role_scope,
      title: tenure.start.title,
      normalized_title: group.normalized_title,
      start_date: tenure.start.filing_date,
      start_accession: tenure.start.accession_number,
      end_date: tenure.closedBy?.filing_date ?? null,
      end_accession: tenure.closedBy?.accession_number ?? null,
      last_seen_date: tenure.last.filing_date,
      last_seen_accession: tenure.last.accession_number,
    });
  }

  return { rows: tenures.length };
}

/**
 * `canonical_person_id -> merge target`. Alias awareness is best-effort exactly
 * as it is in `PersonRoleRepo`: a bare registry without the alias token
 * resolves every id to itself.
 *
 * The alias table is read ONCE rather than a `resolve()` per id: a whole-version
 * rebuild holds every canonical person that carries a tenure, so a per-id
 * lookup is one serial round trip per person over the whole corpus. `add()`
 * enforces the single-hop invariant, so one pass over the table is the same
 * answer `resolve()` gives.
 */
async function resolveAliasTargets(
  canonical_person_ids: readonly string[]
): Promise<Map<string, string>> {
  let aliasRepo: CanonicalPersonAliasRepo;
  try {
    aliasRepo = new CanonicalPersonAliasRepo();
  } catch {
    return new Map();
  }
  const byAlias = new Map(
    (await aliasRepo.list()).map((a) => [a.alias_canonical_id, a.target_canonical_id])
  );
  const targets = new Map<string, string>();
  for (const id of canonical_person_ids) {
    targets.set(id, byAlias.get(id) ?? id);
  }
  return targets;
}
