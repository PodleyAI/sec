/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { PersonObservationTitleRepo } from "../storage/observation/PersonObservationTitleRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import { ObservationProvenanceRepo } from "../storage/provenance/ObservationProvenanceRepo";

export interface ReapStaleObservationsArgs {
  readonly accession_number: string;
  readonly extractor_id: string;
  /**
   * Run-start timestamp (ISO 8601). Observations for this filing+extractor whose
   * `created_at` is strictly older were NOT re-observed by the current run, so
   * they are stale orphans from a prior (larger / differently-classified)
   * extraction and are reaped. `upsertByNaturalKey` refreshes `created_at` to
   * the run time on every re-observe, so surviving rows keep their stable
   * `observation_id` (and the beneficial-ownership / related-party / merger FKs
   * that reference it stay valid).
   */
  readonly before: string;
}

/** Minimal shape of a dead-letter the reap gate inspects. */
export interface ReapGateDeadLetter {
  readonly accession_number: string;
  readonly reason_code: string;
  readonly section_name: string;
  readonly last_attempt_at: string;
}

/**
 * Whether the just-finished run recorded a dead-letter meaning a section FAILED
 * to produce its entities — in which case the reaper must NOT run, because the
 * failed section wrote no observations and its prior-run rows would be deleted
 * as false orphans (silent data loss).
 *
 * `sectionRunner` records several reason codes without aborting the filing; only
 * two are safe to reap through:
 * - `SECTION_NOT_FOUND` — the section is genuinely absent from this filing, so
 *   its old observations really are stale and should be reaped. (Common: most
 *   filings lack some optional section, so blocking on this would disable the
 *   reaper entirely.)
 * - a `<section>-partial` marker — the section DID persist its verified rows
 *   (partial success), so the reap can safely remove the dropped orphans.
 *
 * Every other fresh code — `MODEL_EMPTY`, `LOW_CONFIDENCE_ALL`, a whole-section
 * `UNVERIFIED_SOURCE_SPAN`, `MODEL_INVALID_OUTPUT` — denotes a section that
 * yielded zero rows this run for a reason that may be transient (rate limit,
 * truncated/empty model response, a swallowed exception), so the reap is
 * suppressed until a clean re-extraction. Only dead-letters touched THIS run
 * (`last_attempt_at >= since`) count; a stale entry from a prior run does not
 * pin the reaper forever.
 */
export function hasBlockingSectionFailure(
  deadLetters: readonly ReapGateDeadLetter[],
  accession_number: string,
  since: string
): boolean {
  return deadLetters.some(
    (d) =>
      d.accession_number === accession_number &&
      d.last_attempt_at >= since &&
      d.reason_code !== "SECTION_NOT_FOUND" &&
      !d.section_name.endsWith("-partial")
  );
}

export interface ReapStaleObservationsDeps {
  personObservationRepo?: PersonObservationRepo;
  personObservationTitleRepo?: PersonObservationTitleRepo;
  companyObservationRepo?: CompanyObservationRepo;
  personIdentityLinkRepo?: PersonIdentityLinkRepo;
  companyIdentityLinkRepo?: CompanyIdentityLinkRepo;
  observationProvenanceRepo?: ObservationProvenanceRepo;
}

/**
 * Remove the phantom rows a re-extraction leaves behind. Observation rows are
 * upserted by positional `(accession, extractor_id, observation_index)`, so a
 * re-extraction that yields FEWER entities — or reclassifies one from company
 * to person (a different table at the same index) — overwrites the live rows
 * but never deletes the now-stale high-index / wrong-kind rows. Those orphans
 * stay joined to canonical entities through their identity links, manufacturing
 * entities the filing no longer describes.
 *
 * Run AFTER a successful extraction. For each observation of (accession,
 * extractor_id) not refreshed this run (`created_at < before`): delete its
 * identity links (all resolver versions) and provenance, then delete the
 * observation row. Re-observed rows are untouched.
 *
 * Deleting the links is the load-bearing half and is NOT bookkeeping that a
 * projection could redo. A link left pointing at a reaped observation makes
 * both rebuilds raise by design, and a rebuild that raises leaves its tables
 * as they were rather than purging them — so this is what stops one dangling
 * row becoming a whole-table loss. Junction counts and tenures are recomputed
 * from what survives and need no retraction here.
 */
export async function reapStaleObservations(
  args: ReapStaleObservationsArgs,
  deps: ReapStaleObservationsDeps = {}
): Promise<{ reaped: number }> {
  const personObs = deps.personObservationRepo ?? new PersonObservationRepo();
  const personTitles = deps.personObservationTitleRepo ?? new PersonObservationTitleRepo();
  const companyObs = deps.companyObservationRepo ?? new CompanyObservationRepo();
  const personLinks = deps.personIdentityLinkRepo ?? new PersonIdentityLinkRepo();
  const companyLinks = deps.companyIdentityLinkRepo ?? new CompanyIdentityLinkRepo();
  const provenance = deps.observationProvenanceRepo ?? new ObservationProvenanceRepo();

  let reaped = 0;

  const people = await personObs.listByAccessionAndExtractor(
    args.accession_number,
    args.extractor_id
  );
  for (const o of people) {
    if (o.created_at >= args.before) continue; // refreshed this run — keep
    await personLinks.deleteForObservation(o.observation_id);
    await provenance.deleteForObservation("person", o.observation_id);
    await personTitles.deleteForObservation(o.observation_id);
    await personObs.deleteByObservationId(o.observation_id);
    reaped++;
  }

  const companies = await companyObs.listByAccessionAndExtractor(
    args.accession_number,
    args.extractor_id
  );
  for (const o of companies) {
    if (o.created_at >= args.before) continue; // refreshed this run — keep
    await companyLinks.deleteForObservation(o.observation_id);
    await provenance.deleteForObservation("company", o.observation_id);
    await companyObs.deleteByObservationId(o.observation_id);
    reaped++;
  }

  return { reaped };
}
