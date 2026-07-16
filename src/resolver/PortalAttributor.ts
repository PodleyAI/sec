/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AccreditedPortalSignalRepo } from "../storage/accredited-portal/AccreditedPortalSignalRepo";
import { FormDPortalAttributionRepo } from "../storage/accredited-portal/FormDPortalAttributionRepo";
import type { AccreditedPortalSignalType } from "../storage/accredited-portal/AccreditedPortalSignalSchema";
import type { FormDPortalAttribution } from "../storage/accredited-portal/FormDPortalAttributionSchema";

export const PORTAL_ATTRIBUTOR_VERSION = "1.0.0";

/**
 * A normalized value harvested from a Form D filing, ready for exact-equality
 * lookup against the accredited-portal signal table. `via` records the filing
 * role the value came from (e.g. "form-d:primary-issuer").
 */
export interface AttributionCandidate {
  readonly signal_type: AccreditedPortalSignalType;
  readonly signal_value: string;
  readonly via: string;
}

export interface AttributionInput {
  readonly accession_number: string;
  readonly cik: number | null;
  readonly filing_date: string | null;
  readonly candidates: readonly AttributionCandidate[];
}

/**
 * Shared back-office addresses are the most deliberate portal fingerprint and
 * bare names the most collision-prone, so ties break address > phone > name.
 */
const SIGNAL_STRENGTH: Record<AccreditedPortalSignalType, number> = {
  address: 3,
  phone: 2,
  name: 1,
};

interface PortalAttributorOptions {
  signalRepo?: AccreditedPortalSignalRepo;
  attributionRepo?: FormDPortalAttributionRepo;
  scopePortalId?: string;
}

/**
 * Matches a filing's harvested candidates against the curated portal signal
 * table and upserts one attribution row per matched portal. Pure lookup — no
 * fuzzy matching; curation of the signal table is the tuning knob.
 */
export class PortalAttributor {
  private readonly signalRepo: AccreditedPortalSignalRepo;
  private readonly attributionRepo: FormDPortalAttributionRepo;
  private readonly scopePortalId: string | undefined;

  constructor(options: PortalAttributorOptions = {}) {
    this.signalRepo = options.signalRepo ?? new AccreditedPortalSignalRepo();
    this.attributionRepo = options.attributionRepo ?? new FormDPortalAttributionRepo();
    this.scopePortalId = options.scopePortalId;
  }

  async attribute(input: AttributionInput): Promise<FormDPortalAttribution[]> {
    const deduped = new Map<string, AttributionCandidate>();
    for (const candidate of input.candidates) {
      if (!candidate.signal_value) continue;
      const key = `${candidate.signal_type}|${candidate.signal_value}`;
      if (!deduped.has(key)) deduped.set(key, candidate);
    }

    const matchesByPortal = new Map<string, AttributionCandidate[]>();
    for (const candidate of deduped.values()) {
      const signal = await this.signalRepo.getSignal(candidate.signal_type, candidate.signal_value);
      if (!signal) continue;
      if (this.scopePortalId !== undefined && signal.portal_id !== this.scopePortalId) continue;
      const bucket = matchesByPortal.get(signal.portal_id);
      if (bucket) {
        bucket.push(candidate);
      } else {
        matchesByPortal.set(signal.portal_id, [candidate]);
      }
    }

    const written: FormDPortalAttribution[] = [];
    for (const [portal_id, matches] of matchesByPortal) {
      const strongest = [...matches].sort(
        (a, b) => SIGNAL_STRENGTH[b.signal_type] - SIGNAL_STRENGTH[a.signal_type]
      )[0];
      const attribution: FormDPortalAttribution = {
        accession_number: input.accession_number,
        portal_id,
        cik: input.cik,
        filing_date: input.filing_date,
        matched_signal_type: strongest.signal_type,
        matched_signal_value: strongest.signal_value,
        matches: JSON.stringify(matches),
        attributor_version: PORTAL_ATTRIBUTOR_VERSION,
        created_at: new Date().toISOString(),
      };
      await this.attributionRepo.saveAttribution(attribution);
      written.push(attribution);
    }
    return written;
  }
}
