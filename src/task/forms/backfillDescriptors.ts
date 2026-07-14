/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { globalServiceRegistry } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SpacMergerExtractionRepo } from "../../storage/spac/SpacMergerExtractionRepo";
import { FORM_TO_EXTRACTOR_ID, type ExtractorId } from "../../storage/versioning/extractorIds";
import { hasRedemptionTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import { hasLoiTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kLoiTriggers";

export interface BackfillCandidate {
  readonly cik: number;
  readonly accession_number: string;
}

/**
 * Per-extractor backfill wiring. A new extractor gets a generalized backfill by
 * either (a) nothing at all — every form-routed extractor id (the values of
 * {@link FORM_TO_EXTRACTOR_ID}) is backfillable by default over the filings of
 * its forms — or (b) one descriptor entry here when its candidate set is not
 * "all filings of my forms" (sub-extractors gated on trigger items / known
 * SPACs) or when a successful `extractor_runs` row does not imply the work was
 * done (gated no-ops that record success).
 */
export interface BackfillDescriptor {
  readonly extractorId: string;
  /**
   * Filings this extractor should have processed, enumerated from the local
   * `filing` metadata (no network discovery).
   */
  readonly selectCandidates: () => Promise<BackfillCandidate[]>;
  /**
   * Reduce candidates to those still needing work. Default (when absent): a
   * bulk anti-join against `extractor_runs` at the active extractor version.
   * Override when a recorded success can be a gated no-op — e.g. merger-proxy
   * records `success: true` when the spac row did not exist yet, so its
   * predicate is "no extraction row" instead.
   */
  readonly filterTodo?: (candidates: BackfillCandidate[]) => Promise<BackfillCandidate[]>;
}

/** All form symbols routed to the given extractor id. */
export function formsForExtractor(extractorId: string): string[] {
  return Object.entries(FORM_TO_EXTRACTOR_ID)
    .filter(([, id]) => id === extractorId)
    .map(([form]) => form);
}

/** Candidates = every filing of the given forms (bulk per-form queries). */
async function selectFilingsByForms(forms: readonly string[]): Promise<BackfillCandidate[]> {
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const out: BackfillCandidate[] = [];
  for (const form of forms) {
    const filings = (await filingRepo.query({ form })) ?? [];
    for (const f of filings) {
      out.push({ cik: f.cik, accession_number: f.accession_number });
    }
  }
  return out;
}

/**
 * Candidates for a known-SPAC 8-K sub-extractor: 8-K / 8-K/A filings of a CIK
 * with a spac row whose items string passes the trigger predicate. Loads the
 * full 8-K sets in two bulk queries and filters in memory (cheaper than
 * `2 × NUM_SPACS` `(form, cik)` queries as the SPAC count grows).
 */
function spacTrigger8KSelector(
  hasTriggerItem: (items: string | null | undefined) => boolean
): () => Promise<BackfillCandidate[]> {
  return async () => {
    const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const spacs = await new SpacRepo().getAllSpacs();
    const spacCiks = new Set(spacs.map((s) => s.cik));
    const out: BackfillCandidate[] = [];
    for (const form of ["8-K", "8-K/A"]) {
      const filings = (await filingRepo.query({ form })) ?? [];
      for (const f of filings) {
        if (!spacCiks.has(f.cik)) continue;
        if (hasTriggerItem(f.items)) {
          out.push({ cik: f.cik, accession_number: f.accession_number });
        }
      }
    }
    return out;
  };
}

/**
 * Candidates for merger-proxy recovery: known-SPAC merger proxies, queried by
 * `(form, cik)` (the filings storage is indexed on it) so only each SPAC's
 * proxies load. `filterTodo` keeps those with no extraction row: the known-SPAC
 * gate records a `success: true` no-op run when the spac row does not exist at
 * ingestion, so the default extractor-runs anti-join would never revisit them.
 */
const mergerProxyDescriptor: BackfillDescriptor = {
  extractorId: "merger-proxy",
  selectCandidates: async () => {
    const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const spacs = await new SpacRepo().getAllSpacs();
    const out: BackfillCandidate[] = [];
    for (const spac of spacs) {
      for (const form of formsForExtractor("merger-proxy")) {
        const filings = (await filingRepo.query({ form, cik: spac.cik })) ?? [];
        for (const f of filings) {
          out.push({ cik: f.cik, accession_number: f.accession_number });
        }
      }
    }
    return out;
  },
  filterTodo: async (candidates) => {
    const extractions = new SpacMergerExtractionRepo();
    const todo: BackfillCandidate[] = [];
    for (const c of candidates) {
      if (!(await extractions.getByAccession(c.accession_number))) todo.push(c);
    }
    return todo;
  },
};

/** Sub-extractors and gated extractors whose candidate set is not form-derived. */
const CUSTOM_DESCRIPTORS: Readonly<Record<string, BackfillDescriptor>> = {
  redemption: {
    extractorId: "redemption",
    selectCandidates: spacTrigger8KSelector(hasRedemptionTriggerItem),
  },
  loi: {
    extractorId: "loi",
    selectCandidates: spacTrigger8KSelector(hasLoiTriggerItem),
  },
  "merger-proxy": mergerProxyDescriptor,
};

/**
 * Resolve the backfill descriptor for an extractor id. Custom descriptors win;
 * any other extractor id with routed forms gets the generic all-filings-of-its-
 * forms descriptor. Returns undefined for unknown / non-backfillable ids.
 */
export function getBackfillDescriptor(extractorId: string): BackfillDescriptor | undefined {
  const custom = CUSTOM_DESCRIPTORS[extractorId];
  if (custom) return custom;
  const forms = formsForExtractor(extractorId);
  if (forms.length === 0) return undefined;
  return {
    extractorId,
    selectCandidates: () => selectFilingsByForms(forms),
  };
}

/** Every extractor id `sec extractor backfill` accepts (for CLI help / errors). */
export function listBackfillableExtractorIds(): ExtractorId[] {
  const ids = new Set<string>(Object.values(FORM_TO_EXTRACTOR_ID));
  for (const id of Object.keys(CUSTOM_DESCRIPTORS)) ids.add(id);
  return [...ids].sort() as ExtractorId[];
}
