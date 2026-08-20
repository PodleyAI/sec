/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { LOI_TRIGGER_ITEMS } from "../../sec/forms/miscellaneous-filings/spac8kLoiTriggers";
import { REDEMPTION_TRIGGER_ITEMS } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import { MILESTONE_ITEM_CODES } from "../../sec/forms/miscellaneous-filings/Form_8_K.storage";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import type { Filing } from "../../storage/filing/FilingSchema";
import { SpacLoiExtractionRepo } from "../../storage/spac/SpacLoiExtractionRepo";
import { SpacMergerExtractionRepo } from "../../storage/spac/SpacMergerExtractionRepo";
import { SpacRedemptionExtractionRepo } from "../../storage/spac/SpacRedemptionExtractionRepo";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { formToExtractorId, isSpacRowGatedExtractor } from "../../storage/versioning/extractorIds";

/**
 * The 8-K item codes a known-SPAC handler can act on: de-SPAC milestones plus
 * the redemption and LOI detectors' trigger sets. An 8-K carrying none of them
 * writes nothing whether or not the spac row exists, so it is never evidence
 * of a gated no-op.
 */
const GATED_8K_ITEM_CODES: ReadonlySet<string> = new Set([
  ...MILESTONE_ITEM_CODES,
  ...REDEMPTION_TRIGGER_ITEMS,
  ...LOI_TRIGGER_ITEMS,
]);

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
 * - **25/15** — no event on the accession.
 * - **merger-proxy** — no `spac_merger_extraction` row, mirroring the backfill
 *   descriptor's own override.
 * - **8-K** — its items carry a code a known-SPAC handler acts on, AND it has
 *   no event, no redemption row, no LOI row, and no redemption / LOI
 *   dead-letter entry.
 *
 * Both 8-K preconditions are load-bearing. Without the item-code test, a `2.02`
 * earnings 8-K — which writes nothing either way — would be re-selected on
 * every sweep forever, undoing the skip entirely. Without the dead-letter test,
 * a confident "no redemption / no LOI reported" negative, whose `MODEL_EMPTY`
 * entry is auto-resolved rather than deleted, would be re-paid as an AI call on
 * every sweep: a resolved entry is durable evidence the detector ran.
 *
 * Returns the empty set when the issuer still has no `spac` row — replaying
 * then repairs nothing, and the skip must stand.
 */
export async function loadGatedNoOpAccessions(
  cik: number,
  timeline: readonly Filing[]
): Promise<ReadonlySet<string>> {
  const gated: Filing[] = [];
  for (const filing of timeline) {
    if (filing.form === null) continue;
    const extractorId = formToExtractorId(filing.form);
    if (extractorId === undefined) continue;
    if (isSpacRowGatedExtractor(extractorId)) gated.push(filing);
  }
  if (gated.length === 0) return new Set();

  const spacRepo = new SpacRepo();
  if ((await spacRepo.getSpac(cik)) === undefined) return new Set();

  const withEvent = new Set((await spacRepo.getEvents(cik)).map((e) => e.accession_number));
  const mergerExtractions = new SpacMergerExtractionRepo();
  const redemptions = new SpacRedemptionExtractionRepo();
  const lois = new SpacLoiExtractionRepo();
  let detected: Set<string> | undefined;

  const out = new Set<string>();
  for (const filing of gated) {
    const extractorId = formToExtractorId(filing.form!)!;
    if (extractorId === "25-15") {
      if (!withEvent.has(filing.accession_number)) out.add(filing.accession_number);
      continue;
    }
    if (extractorId === "merger-proxy") {
      if (!(await mergerExtractions.getByAccession(filing.accession_number))) {
        out.add(filing.accession_number);
      }
      continue;
    }
    if (!itemCodes(filing.items).some((code) => GATED_8K_ITEM_CODES.has(code))) continue;
    if (withEvent.has(filing.accession_number)) continue;
    if (detected === undefined) detected = await loadDetectorAccessions();
    if (detected.has(filing.accession_number)) continue;
    if (await redemptions.getByAccession(filing.accession_number)) continue;
    if (await lois.getByAccession(filing.accession_number)) continue;
    out.add(filing.accession_number);
  }
  return out;
}

/**
 * Accessions the redemption / LOI detectors have already answered on, read from
 * their dead-letter entries in ANY status — a resolved expected negative is the
 * only trace a confident "nothing reported" leaves.
 */
async function loadDetectorAccessions(): Promise<Set<string>> {
  const repo = new ExtractionDeadLetterRepo();
  const out = new Set<string>();
  for (const extractorId of ["redemption", "loi"]) {
    for (const row of await repo.listAll(extractorId)) {
      out.add(row.accession_number);
    }
  }
  return out;
}
