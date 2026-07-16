/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { streamMatchingRows } from "../cli/queries/_streamMatches";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { COMPANY_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/CompanyObservationSchema";
import { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/PersonObservationSchema";
import { AccreditedPortalSignalRepo } from "../storage/accredited-portal/AccreditedPortalSignalRepo";
import type { AccreditedPortalSignal } from "../storage/accredited-portal/AccreditedPortalSignalSchema";
import { FormDPortalAttributionRepo } from "../storage/accredited-portal/FormDPortalAttributionRepo";
import { isBadPersonField } from "../types/edgar/bad-data";
import type { AttributionCandidate } from "./PortalAttributor";
import { PortalAttributor, pushAttributionCandidates, signalKeyOf } from "./PortalAttributor";

export interface BackfillFormDAttributionResult {
  readonly filings: number;
  readonly attributions: number;
  readonly cleared: number;
}

function relationOf(source_context: string | null | undefined): string {
  if (!source_context) return "form-d:unknown";
  try {
    const parsed = JSON.parse(source_context);
    return typeof parsed?.relation === "string" ? parsed.relation : "form-d:unknown";
  } catch {
    return "form-d:unknown";
  }
}

/**
 * Recomputes Form D → accredited-portal attributions from the stored
 * observation tier (extractor_id "D"), so re-attribution after signal changes
 * never needs the raw filings. Clear-then-recompute: the affected scope (one
 * portal, or the whole table) is cleared first so removed signals also drop
 * their stale attributions.
 *
 * The signal table is loaded once (it is small, curated, and invariant for
 * the sweep) and harvested candidates are kept only when they match a loaded
 * signal — non-matching candidates can never attribute, so resident memory is
 * bounded by the match count rather than the observation corpus, and only
 * accessions with at least one match pay a filing lookup and write.
 */
export async function backfillFormDAttribution(options: {
  portalId?: string;
}): Promise<BackfillFormDAttributionResult> {
  const attributionRepo = new FormDPortalAttributionRepo();
  const signalRepo = new AccreditedPortalSignalRepo();

  let cleared = 0;
  if (options.portalId !== undefined) {
    cleared = await attributionRepo.clearPortal(options.portalId);
  } else {
    await attributionRepo.clearAll();
  }

  const signals =
    options.portalId !== undefined
      ? await signalRepo.listByPortal(options.portalId)
      : await signalRepo.getAllSignals();
  const signalLookup = new Map<string, AccreditedPortalSignal>(
    signals.map((s) => [signalKeyOf(s.signal_type, s.signal_value), s])
  );
  if (signalLookup.size === 0) {
    return { filings: 0, attributions: 0, cleared };
  }

  const attributor = new PortalAttributor({
    attributionRepo,
    scopePortalId: options.portalId,
    scopeAlreadyCleared: true,
    signalLookup,
  });

  const candidatesByAccession = new Map<string, AttributionCandidate[]>();
  const keepMatching = (accession_number: string, harvested: AttributionCandidate[]): void => {
    for (const candidate of harvested) {
      if (!signalLookup.has(signalKeyOf(candidate.signal_type, candidate.signal_value))) continue;
      let kept = candidatesByAccession.get(accession_number);
      if (!kept) {
        kept = [];
        candidatesByAccession.set(accession_number, kept);
      }
      kept.push(candidate);
    }
  };

  const companyRepo = globalServiceRegistry.get(COMPANY_OBSERVATION_REPOSITORY_TOKEN);
  for await (const obs of streamMatchingRows(companyRepo, { extractor_id: "D" }, () => true)) {
    const harvested: AttributionCandidate[] = [];
    pushAttributionCandidates(harvested, relationOf(obs.source_context), {
      name: obs.normalized_name || obs.name || null,
      address_hash_id: obs.raw_address_id,
      international_number: obs.raw_phone_id,
    });
    keepMatching(obs.accession_number, harvested);
  }

  const personRepo = globalServiceRegistry.get(PERSON_OBSERVATION_REPOSITORY_TOKEN);
  for await (const obs of streamMatchingRows(personRepo, { extractor_id: "D" }, () => true)) {
    // Same part filter as the ingest path (processRelatedPerson): stored
    // person rows keep raw placeholder tokens ("None", "N/A"), which must
    // not leak into the reconstructed name signal.
    const fullName = [obs.first_name, obs.middle_name, obs.last_name]
      .filter((name): name is string => Boolean(name) && !isBadPersonField(name!))
      .join(" ");
    const harvested: AttributionCandidate[] = [];
    pushAttributionCandidates(harvested, relationOf(obs.source_context), {
      name: fullName || null,
      address_hash_id: obs.raw_address_id,
      international_number: obs.raw_phone_id,
    });
    keepMatching(obs.accession_number, harvested);
  }

  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  let attributions = 0;
  for (const [accession_number, candidates] of candidatesByAccession) {
    const filings = (await filingRepo.query({ accession_number })) ?? [];
    const filing = filings[0];
    const written = await attributor.attribute({
      accession_number,
      cik: filing?.cik ?? null,
      filing_date: filing?.filing_date ?? null,
      candidates,
    });
    attributions += written.length;
  }

  return { filings: candidatesByAccession.size, attributions, cleared };
}
