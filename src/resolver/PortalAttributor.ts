/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AccreditedPortalSignalRepo } from "../storage/accredited-portal/AccreditedPortalSignalRepo";
import { FormDPortalAttributionRepo } from "../storage/accredited-portal/FormDPortalAttributionRepo";
import type { AccreditedPortalSignalType } from "../storage/accredited-portal/AccreditedPortalSignalSchema";
import type { FormDPortalAttribution } from "../storage/accredited-portal/FormDPortalAttributionSchema";
import { normalizeNameSignal } from "../storage/accredited-portal/SignalNormalization";

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

/**
 * Shared candidate builder for the two producers (live Form D ingest and the
 * observation backfill). Both paths MUST harvest identically or a recompute
 * can attribute differently than first ingest: names go through
 * {@link normalizeNameSignal}, while address/phone reuse the ids the ingest
 * path already normalized (address_hash_id, international_number).
 */
export function pushAttributionCandidates(
  candidates: AttributionCandidate[],
  via: string,
  parts: {
    name?: string | null;
    address_hash_id?: string | null;
    international_number?: string | null;
  }
): void {
  const name = normalizeNameSignal(parts.name);
  if (name) candidates.push({ signal_type: "name", signal_value: name, via });
  if (parts.address_hash_id) {
    candidates.push({ signal_type: "address", signal_value: parts.address_hash_id, via });
  }
  if (parts.international_number) {
    candidates.push({ signal_type: "phone", signal_value: parts.international_number, via });
  }
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

/** Deterministic candidate order: strength desc, then type, value, via. */
function compareCandidates(a: AttributionCandidate, b: AttributionCandidate): number {
  return (
    SIGNAL_STRENGTH[b.signal_type] - SIGNAL_STRENGTH[a.signal_type] ||
    a.signal_type.localeCompare(b.signal_type) ||
    a.signal_value.localeCompare(b.signal_value) ||
    a.via.localeCompare(b.via)
  );
}

interface PortalAttributorOptions {
  signalRepo?: AccreditedPortalSignalRepo;
  attributionRepo?: FormDPortalAttributionRepo;
  scopePortalId?: string;
}

/**
 * Matches a filing's harvested candidates against the curated portal signal
 * table and writes one attribution row per matched portal. Pure lookup — no
 * fuzzy matching; curation of the signal table is the tuning knob.
 *
 * Unscoped attribution is clear-then-recompute per accession: prior rows for
 * the filing are deleted first, so a replay after signals changed cannot
 * leave stale attributions behind. When `scopePortalId` is set (the scoped
 * backfill, which clears its portal up front), rows for other portals are
 * left untouched and matches outside the scope are discarded.
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
    if (this.scopePortalId === undefined) {
      await this.attributionRepo.clearAccession(input.accession_number);
    }

    // Dedup to one lookup per (type, value) while keeping every filing role
    // that produced the value — corroborating roles belong in the audit trail.
    const deduped = new Map<string, AttributionCandidate[]>();
    for (const candidate of input.candidates) {
      if (!candidate.signal_value) continue;
      const key = `${candidate.signal_type}|${candidate.signal_value}`;
      const bucket = deduped.get(key);
      if (!bucket) {
        deduped.set(key, [candidate]);
      } else if (!bucket.some((c) => c.via === candidate.via)) {
        bucket.push(candidate);
      }
    }
    if (deduped.size === 0) return [];

    const signals = await this.signalRepo.getSignalsBulk(
      [...deduped.values()].map(([first]) => ({
        signal_type: first.signal_type,
        signal_value: first.signal_value,
      }))
    );

    const matchesByPortal = new Map<string, AttributionCandidate[]>();
    for (const signal of signals) {
      if (this.scopePortalId !== undefined && signal.portal_id !== this.scopePortalId) continue;
      const candidates = deduped.get(`${signal.signal_type}|${signal.signal_value}`);
      if (!candidates) continue;
      const bucket = matchesByPortal.get(signal.portal_id);
      if (bucket) {
        bucket.push(...candidates);
      } else {
        matchesByPortal.set(signal.portal_id, [...candidates]);
      }
    }

    const written: FormDPortalAttribution[] = [];
    for (const [portal_id, matches] of matchesByPortal) {
      matches.sort(compareCandidates);
      const strongest = matches[0];
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
