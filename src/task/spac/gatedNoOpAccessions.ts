/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { listingRemovalNeedsWork } from "../../sec/forms/exchange-listing-withdrawal/processDeregistration";
import { extractorIdsForForm } from "../../sec/forms/formExtractors";
import { LOI_TRIGGER_ITEMS } from "../../sec/forms/miscellaneous-filings/spac8kLoiTriggers";
import { REDEMPTION_TRIGGER_ITEMS } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { loadAnsweredMergerSections } from "../../storage/dead-letter/answeredMergerSections";
import type { Filing } from "../../storage/filing/FilingSchema";
import { SpacLoiExtractionRepo } from "../../storage/spac/SpacLoiExtractionRepo";
import { SpacMergerExtractionRepo } from "../../storage/spac/SpacMergerExtractionRepo";
import { SpacRedemptionExtractionRepo } from "../../storage/spac/SpacRedemptionExtractionRepo";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { isSpacRowGatedExtractor } from "../../storage/versioning/extractorIds";

/**
 * 8-K item codes `mapItemCodesToSpacEvents` maps to an event UNCONDITIONALLY.
 * Some map to a lifecycle milestone and some to `material_agreement` /
 * `eight_k`, but every one of them writes a row — so an 8-K carrying one, with
 * no event recorded, really is a filing whose handler was gated and dropped its
 * work.
 *
 * Item `5.03` is deliberately NOT here, though it is a milestone item code.
 * It maps to an event only when `extractNameChange` finds a new registrant name
 * in the 8-K NARRATIVE, and the narrative is non-null only when the fetch was
 * escalated to the full submission — which `ProcessAccessionDocFormTask` does
 * for the redemption / LOI trigger items alone. A 5.03-only 8-K therefore has
 * no narrative by construction, writes no event on any run, and (having no
 * full submission text) runs neither detector, so it leaves no dead letter
 * either. Selecting on it re-processes the filing on every sweep, forever, and
 * nothing it can write would ever stop that. Adding it back is the regression.
 * A 5.03 filed ALONGSIDE a redemption / LOI trigger item is still selected —
 * on that other code, which does escalate the fetch.
 */
const ALWAYS_EVENT_MAPPED_ITEMS: readonly string[] = ["1.01", "1.02", "2.01", "5.07"];

/**
 * The 8-K item codes a known-SPAC handler can act on: the unconditionally
 * event-mapped milestones plus the redemption and LOI detectors' trigger sets.
 * An 8-K carrying none of them writes nothing whether or not the spac row
 * exists, so it is never evidence of a gated no-op.
 */
const GATED_8K_ITEM_CODES: ReadonlySet<string> = new Set([
  ...ALWAYS_EVENT_MAPPED_ITEMS,
  ...REDEMPTION_TRIGGER_ITEMS,
  ...LOI_TRIGGER_ITEMS,
]);

/** The detectors whose dead-letter entries answer for a trigger 8-K. */
const DETECTOR_EXTRACTOR_IDS: readonly string[] = ["redemption", "loi"];

/**
 * A filing whose form routes to at least one known-SPAC-gated extractor, paired
 * with the ids that form routes to. The ids are carried rather than re-derived
 * because the branches below ask which of them is present, and a form may route
 * to several.
 */
interface GatedFiling {
  readonly filing: Filing;
  readonly extractorIds: readonly string[];
}

function itemCodes(items: string | null | undefined): string[] {
  if (!items) return [];
  return items
    .split(/[,;]/)
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

/**
 * The accessions on one issuer's timeline whose extractor recorded a
 * SUCCESSFUL run while writing nothing, because its known-SPAC gate found no
 * `spac` row at the time.
 *
 * `sec spac process` exists to repair exactly that: the 8-K, merger-proxy and
 * 25/15 handlers return early — recording `success: true` — when the row the
 * registration statement mints does not exist yet, so the ordinary
 * already-succeeded skip never revisits them and their events are dropped
 * permanently. Re-selecting them is only safe filing by filing, on evidence
 * that the handler did not in fact produce its artifact:
 *
 * - **25/15** — {@link listingRemovalNeedsWork}, the predicate the backfill
 *   descriptor selects on too: the event the live classifier names is not yet
 *   recorded on this accession, and the classifier does not say `ignore`.
 * - **merger-proxy** — no `spac_merger_extraction` row AND no dead-letter entry
 *   for the merger section, mirroring the 8-K rule below.
 * - **8-K** — its items carry a code a known-SPAC handler acts on, AND it has
 *   no event, no redemption row, no LOI row, and no redemption / LOI
 *   dead-letter entry.
 *
 * Every branch is MONOTONE: processing the filing writes the artifact the
 * branch keys on (an event, an extraction row, or a dead-letter entry), which
 * takes it out of the set. That is the whole invariant — a branch that can
 * select a filing nothing it writes would deselect makes `spac process`
 * re-process that filing on every run for the life of the database.
 *
 * All three preconditions are load-bearing for it. Without the item-code test,
 * a `2.02` earnings 8-K — which writes nothing either way — would be replayed
 * on every sweep, undoing the skip entirely. Without the dead-letter tests, a
 * confident "no redemption / no LOI reported" negative and an ordinary
 * `DEF 14A` with no merger section — both expected outcomes that write no row —
 * would be re-paid as AI calls forever. And without the classifier test, a
 * de-SPAC'd foreign private issuer's annual 20-F, which the classifier ignores,
 * would be re-selected once a year forever.
 *
 * Returns the empty set when the issuer still has no `spac` row — replaying
 * then repairs nothing, and the skip must stand. `ProcessSpacTimelineTask`
 * recomputes this AFTER its replay for exactly that reason: the registration
 * statement that mints the row is usually on the same timeline.
 */
export async function loadGatedNoOpAccessions(
  cik: number,
  timeline: readonly Filing[]
): Promise<ReadonlySet<string>> {
  const gated: GatedFiling[] = [];
  for (const filing of timeline) {
    if (filing.form === null) continue;
    // ANY of the form's extractors being gated makes the filing gated: the
    // question is whether a known-SPAC gate could have swallowed this filing's
    // work, and one gated extractor among several is enough for that.
    const extractorIds = extractorIdsForForm(filing.form);
    if (extractorIds.some(isSpacRowGatedExtractor)) gated.push({ filing, extractorIds });
  }
  if (gated.length === 0) return new Set();

  const spacRepo = new SpacRepo();
  const spacRow = await spacRepo.getSpac(cik);
  if (spacRow === undefined) return new Set();

  const events = await spacRepo.getEvents(cik);
  const withEvent = new Set(events.map((e) => e.accession_number));

  const out = new Set<string>();
  const mergerProxies: string[] = [];
  // 8-Ks that survived the item-code and event tests. Collected first so the
  // detector dead letters are read in one query bounded by this issuer's
  // timeline rather than by the whole extractor's table.
  const detectorCandidates: string[] = [];

  for (const { filing, extractorIds } of gated) {
    if (extractorIds.includes("25-15")) {
      const needsWork = await listingRemovalNeedsWork({
        cik,
        form: filing.form,
        filingDate: filing.filing_date,
        accession_number: filing.accession_number,
        ipoDate: spacRow.ipo_date,
        events,
      });
      if (needsWork) out.add(filing.accession_number);
      continue;
    }
    if (extractorIds.includes("merger-proxy")) {
      mergerProxies.push(filing.accession_number);
      continue;
    }
    if (!itemCodes(filing.items).some((code) => GATED_8K_ITEM_CODES.has(code))) continue;
    if (withEvent.has(filing.accession_number)) continue;
    detectorCandidates.push(filing.accession_number);
  }

  if (mergerProxies.length > 0) {
    const answered = await loadAnsweredMergerSections(mergerProxies);
    const mergerExtractions = new SpacMergerExtractionRepo();
    for (const accession_number of mergerProxies) {
      if (answered.has(accession_number)) continue;
      if (await mergerExtractions.getByAccession(accession_number)) continue;
      out.add(accession_number);
    }
  }

  if (detectorCandidates.length > 0) {
    const detected = await loadDetectorAccessions(detectorCandidates);
    const redemptions = new SpacRedemptionExtractionRepo();
    const lois = new SpacLoiExtractionRepo();
    for (const accession_number of detectorCandidates) {
      if (detected.has(accession_number)) continue;
      if (await redemptions.getByAccession(accession_number)) continue;
      if (await lois.getByAccession(accession_number)) continue;
      out.add(accession_number);
    }
  }

  return out;
}

/**
 * Of the given accessions, those the redemption / LOI detectors have already
 * answered on, read from their dead-letter entries in ANY status — a resolved
 * expected negative is the only trace a confident "nothing reported" leaves.
 *
 * Scoped to the accessions asked about. Reading every entry of both extractors
 * is a full-table scan per issuer, which a batch over ~1,500 SPACs pays 1,500
 * times over.
 */
async function loadDetectorAccessions(
  accession_numbers: readonly string[]
): Promise<ReadonlySet<string>> {
  const rows = await new ExtractionDeadLetterRepo().listByAccessions(
    accession_numbers,
    DETECTOR_EXTRACTOR_IDS
  );
  return new Set(rows.map((row) => row.accession_number));
}
