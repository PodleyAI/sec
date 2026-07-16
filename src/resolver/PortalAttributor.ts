/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AccreditedPortalSignalRepo } from "../storage/accredited-portal/AccreditedPortalSignalRepo";
import { FormDPortalAttributionRepo } from "../storage/accredited-portal/FormDPortalAttributionRepo";
import type {
  AccreditedPortalSignal,
  AccreditedPortalSignalType,
} from "../storage/accredited-portal/AccreditedPortalSignalSchema";
import type { FormDPortalAttribution } from "../storage/accredited-portal/FormDPortalAttributionSchema";
import { normalizeNameSignal } from "../storage/accredited-portal/SignalNormalization";
import { KeyedMutex } from "../util/KeyedMutex";

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
 * Filing roles that never contribute portal fingerprints. Centralized here so
 * the ingest path (which simply doesn't harvest signatures) and the backfill
 * (which replays every stored observation) enforce the same policy through
 * the shared builder rather than each encoding it separately.
 */
const EXCLUDED_ATTRIBUTION_RELATIONS: ReadonlySet<string> = new Set(["form-d:signature"]);

export function isAttributableRelation(via: string): boolean {
  return !EXCLUDED_ATTRIBUTION_RELATIONS.has(via);
}

/** Composite key used for signal lookups and candidate dedup. */
export function signalKeyOf(signal_type: AccreditedPortalSignalType, signal_value: string): string {
  return `${signal_type}|${signal_value}`;
}

/**
 * Shared candidate builder for the two producers (live Form D ingest and the
 * observation backfill). Both paths MUST harvest identically or a recompute
 * can attribute differently than first ingest: names go through
 * {@link normalizeNameSignal}, while address/phone reuse the ids the ingest
 * path already normalized (address_hash_id, international_number). Excluded
 * roles (signatures) are dropped here for both paths.
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
  if (!isAttributableRelation(via)) return;
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

/**
 * Serializes the clear+write of one accession's attribution rows so a replay
 * racing another processor of the same filing cannot interleave the delete
 * with the other's writes. Module-scoped because every ingest call constructs
 * a fresh {@link PortalAttributor} (mirrors PortalRepo's portalWriteLock).
 */
const attributionWriteLock = new KeyedMutex<string>();

interface PortalAttributorOptions {
  signalRepo?: AccreditedPortalSignalRepo;
  attributionRepo?: FormDPortalAttributionRepo;
  scopePortalId?: string;
  /**
   * Set when the caller has already cleared the recompute scope (the backfill
   * clears the whole table / portal up front), so the per-accession clear
   * would be dead work repeated once per filing.
   */
  scopeAlreadyCleared?: boolean;
  /**
   * Preloaded signal table keyed by {@link signalKeyOf}. The backfill loads
   * the (small, sweep-invariant) signal table once and passes it here so a
   * full-corpus recompute doesn't re-query it per accession. When absent,
   * signals are fetched per call via a single batched lookup.
   */
  signalLookup?: ReadonlyMap<string, AccreditedPortalSignal>;
}

/**
 * Matches a filing's harvested candidates against the curated portal signal
 * table and writes one attribution row per matched portal. Pure lookup — no
 * fuzzy matching; curation of the signal table is the tuning knob.
 *
 * Unscoped attribution is clear-then-recompute per accession: prior rows for
 * the filing are deleted and replaced, so a replay after signals changed
 * cannot leave stale attributions behind. Signal lookups run BEFORE the
 * clear: a transient lookup failure aborts the call with the filing's prior
 * rows intact instead of leaving it stripped. When `scopePortalId` is set
 * (the scoped backfill, which clears its portal up front), rows for other
 * portals are left untouched and matches outside the scope are discarded.
 */
export class PortalAttributor {
  private readonly signalRepo: AccreditedPortalSignalRepo;
  private readonly attributionRepo: FormDPortalAttributionRepo;
  private readonly scopePortalId: string | undefined;
  private readonly scopeAlreadyCleared: boolean;
  private readonly signalLookup: ReadonlyMap<string, AccreditedPortalSignal> | undefined;

  constructor(options: PortalAttributorOptions = {}) {
    this.signalRepo = options.signalRepo ?? new AccreditedPortalSignalRepo();
    this.attributionRepo = options.attributionRepo ?? new FormDPortalAttributionRepo();
    this.scopePortalId = options.scopePortalId;
    this.scopeAlreadyCleared = options.scopeAlreadyCleared ?? false;
    this.signalLookup = options.signalLookup;
  }

  private async lookupSignals(
    deduped: ReadonlyMap<string, AttributionCandidate[]>
  ): Promise<AccreditedPortalSignal[]> {
    if (this.signalLookup) {
      const found: AccreditedPortalSignal[] = [];
      for (const key of deduped.keys()) {
        const signal = this.signalLookup.get(key);
        if (signal) found.push(signal);
      }
      return found;
    }
    return this.signalRepo.getSignalsBulk(
      [...deduped.values()].map(([first]) => ({
        signal_type: first.signal_type,
        signal_value: first.signal_value,
      }))
    );
  }

  async attribute(input: AttributionInput): Promise<FormDPortalAttribution[]> {
    // Dedup to one lookup per (type, value) while keeping every filing role
    // that produced the value — corroborating roles belong in the audit trail.
    const deduped = new Map<string, AttributionCandidate[]>();
    for (const candidate of input.candidates) {
      if (!candidate.signal_value) continue;
      const key = signalKeyOf(candidate.signal_type, candidate.signal_value);
      const bucket = deduped.get(key);
      if (!bucket) {
        deduped.set(key, [candidate]);
      } else if (!bucket.some((c) => c.via === candidate.via)) {
        bucket.push(candidate);
      }
    }

    const signals = deduped.size > 0 ? await this.lookupSignals(deduped) : [];

    const matchesByPortal = new Map<string, AttributionCandidate[]>();
    for (const signal of signals) {
      if (this.scopePortalId !== undefined && signal.portal_id !== this.scopePortalId) continue;
      const candidates = deduped.get(signalKeyOf(signal.signal_type, signal.signal_value));
      if (!candidates) continue;
      const bucket = matchesByPortal.get(signal.portal_id);
      if (bucket) {
        bucket.push(...candidates);
      } else {
        matchesByPortal.set(signal.portal_id, [...candidates]);
      }
    }

    const written: FormDPortalAttribution[] = [];
    await attributionWriteLock.lock(input.accession_number, async () => {
      if (this.scopePortalId === undefined && !this.scopeAlreadyCleared) {
        await this.attributionRepo.clearAccession(input.accession_number);
      }
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
    });
    return written;
  }
}
