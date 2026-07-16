/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { COMPANY_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/CompanyObservationSchema";
import { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/PersonObservationSchema";
import { FormDPortalAttributionRepo } from "../storage/accredited-portal/FormDPortalAttributionRepo";
import { normalizeNameSignal } from "../storage/accredited-portal/SignalNormalization";
import type { AttributionCandidate } from "./PortalAttributor";
import { PortalAttributor } from "./PortalAttributor";

export interface BackfillFormDAttributionResult {
  readonly filings: number;
  readonly attributions: number;
  readonly cleared: number;
}

interface AccessionBucket {
  candidates: AttributionCandidate[];
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

function pushCandidates(
  bucket: AccessionBucket,
  via: string,
  name: string | null,
  raw_address_id: string | null | undefined,
  raw_phone_id: string | null | undefined
): void {
  const nameSignal = normalizeNameSignal(name);
  if (nameSignal) bucket.candidates.push({ signal_type: "name", signal_value: nameSignal, via });
  if (raw_address_id) {
    bucket.candidates.push({ signal_type: "address", signal_value: raw_address_id, via });
  }
  if (raw_phone_id) {
    bucket.candidates.push({ signal_type: "phone", signal_value: raw_phone_id, via });
  }
}

/**
 * Recomputes Form D → accredited-portal attributions from the stored
 * observation tier (extractor_id "D"), so re-attribution after signal changes
 * never needs the raw filings. Clear-then-recompute: the affected scope (one
 * portal, or the whole table) is cleared first so removed signals also drop
 * their stale attributions. Signature observations are skipped, mirroring the
 * ingest path.
 */
export async function backfillFormDAttribution(options: {
  portalId?: string;
}): Promise<BackfillFormDAttributionResult> {
  const attributionRepo = new FormDPortalAttributionRepo();
  const attributor = new PortalAttributor({
    attributionRepo,
    scopePortalId: options.portalId,
  });

  let cleared = 0;
  if (options.portalId !== undefined) {
    cleared = await attributionRepo.clearPortal(options.portalId);
  } else {
    await attributionRepo.clearAll();
  }

  const companyObservations =
    (await globalServiceRegistry
      .get(COMPANY_OBSERVATION_REPOSITORY_TOKEN)
      .query({ extractor_id: "D" })) ?? [];
  const personObservations =
    (await globalServiceRegistry
      .get(PERSON_OBSERVATION_REPOSITORY_TOKEN)
      .query({ extractor_id: "D" })) ?? [];

  const buckets = new Map<string, AccessionBucket>();
  const bucketFor = (accession_number: string): AccessionBucket => {
    let bucket = buckets.get(accession_number);
    if (!bucket) {
      bucket = { candidates: [] };
      buckets.set(accession_number, bucket);
    }
    return bucket;
  };

  for (const obs of companyObservations) {
    const via = relationOf(obs.source_context);
    if (via === "form-d:signature") continue;
    pushCandidates(
      bucketFor(obs.accession_number),
      via,
      obs.normalized_name ?? obs.name ?? null,
      obs.raw_address_id,
      obs.raw_phone_id
    );
  }

  for (const obs of personObservations) {
    const via = relationOf(obs.source_context);
    if (via === "form-d:signature") continue;
    const fullName = [obs.first_name, obs.middle_name, obs.last_name].filter(Boolean).join(" ");
    pushCandidates(
      bucketFor(obs.accession_number),
      via,
      fullName || null,
      obs.raw_address_id,
      obs.raw_phone_id
    );
  }

  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  let attributions = 0;
  for (const [accession_number, bucket] of buckets) {
    const filings = (await filingRepo.query({ accession_number })) ?? [];
    const filing = filings[0];
    const written = await attributor.attribute({
      accession_number,
      cik: filing?.cik ?? null,
      filing_date: filing?.filing_date ?? null,
      candidates: bucket.candidates,
    });
    attributions += written.length;
  }

  return { filings: buckets.size, attributions, cleared };
}
