/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { ITabularStorage } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { COMPANY_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/CompanyObservationSchema";
import { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/PersonObservationSchema";
import { FormDPortalAttributionRepo } from "../storage/accredited-portal/FormDPortalAttributionRepo";
import { isBadPersonField } from "../types/edgar/bad-data";
import type { AttributionCandidate } from "./PortalAttributor";
import { PortalAttributor, pushAttributionCandidates } from "./PortalAttributor";

export interface BackfillFormDAttributionResult {
  readonly filings: number;
  readonly attributions: number;
  readonly cleared: number;
}

/** Rows fetched per page while sweeping the observation tables. */
const OBSERVATION_PAGE_SIZE = 5000;

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
 * Streams every extractor-"D" row of an observation table in observation_id
 * order via keyset pagination, so a full-EDGAR sweep never materializes the
 * whole table in memory.
 */
async function forEachObservationPage<T extends { readonly observation_id: number }>(
  storage: ITabularStorage<any, any, T>,
  handle: (rows: T[]) => void
): Promise<void> {
  let lastId = -1;
  for (;;) {
    const rows =
      (await storage.query(
        { extractor_id: "D", observation_id: { value: lastId, operator: ">" } } as any,
        {
          orderBy: [{ column: "observation_id", direction: "ASC" }],
          limit: OBSERVATION_PAGE_SIZE,
        }
      )) ?? [];
    if (rows.length === 0) return;
    handle(rows);
    lastId = rows[rows.length - 1].observation_id;
    if (rows.length < OBSERVATION_PAGE_SIZE) return;
  }
}

/**
 * Recomputes Form D → accredited-portal attributions from the stored
 * observation tier (extractor_id "D"), so re-attribution after signal changes
 * never needs the raw filings. Clear-then-recompute: the affected scope (one
 * portal, or the whole table) is cleared first so removed signals also drop
 * their stale attributions. Signature observations are skipped and person
 * name parts drop bad-data placeholders, mirroring the ingest path exactly.
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

  const candidatesByAccession = new Map<string, AttributionCandidate[]>();
  const candidatesFor = (accession_number: string): AttributionCandidate[] => {
    let candidates = candidatesByAccession.get(accession_number);
    if (!candidates) {
      candidates = [];
      candidatesByAccession.set(accession_number, candidates);
    }
    return candidates;
  };

  await forEachObservationPage(
    globalServiceRegistry.get(COMPANY_OBSERVATION_REPOSITORY_TOKEN),
    (rows) => {
      for (const obs of rows) {
        const via = relationOf(obs.source_context);
        if (via === "form-d:signature") continue;
        pushAttributionCandidates(candidatesFor(obs.accession_number), via, {
          name: obs.normalized_name || obs.name || null,
          address_hash_id: obs.raw_address_id,
          international_number: obs.raw_phone_id,
        });
      }
    }
  );

  await forEachObservationPage(
    globalServiceRegistry.get(PERSON_OBSERVATION_REPOSITORY_TOKEN),
    (rows) => {
      for (const obs of rows) {
        const via = relationOf(obs.source_context);
        if (via === "form-d:signature") continue;
        // Same part filter as the ingest path (processRelatedPerson): stored
        // person rows keep raw placeholder tokens ("None", "N/A"), which must
        // not leak into the reconstructed name signal.
        const fullName = [obs.first_name, obs.middle_name, obs.last_name]
          .filter((name): name is string => Boolean(name) && !isBadPersonField(name!))
          .join(" ");
        pushAttributionCandidates(candidatesFor(obs.accession_number), via, {
          name: fullName || null,
          address_hash_id: obs.raw_address_id,
          international_number: obs.raw_phone_id,
        });
      }
    }
  );

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
