/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { globalServiceRegistry } from "workglow";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { loadAnsweredMergerSections } from "../../storage/dead-letter/answeredMergerSections";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import type { SpacEvent } from "../../storage/spac/SpacEventSchema";
import { SpacLoiExtractionRepo } from "../../storage/spac/SpacLoiExtractionRepo";
import { SpacMergerExtractionRepo } from "../../storage/spac/SpacMergerExtractionRepo";
import { SpacRedemptionExtractionRepo } from "../../storage/spac/SpacRedemptionExtractionRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { FORM_TO_EXTRACTOR_ID, type ExtractorId } from "../../storage/versioning/extractorIds";
import { listingRemovalNeedsWork } from "../../sec/forms/exchange-listing-withdrawal/processDeregistration";
import { staffActionAbandonsRegistration } from "../../sec/forms/registration-withdrawal-termination/staffActionAbandonsRegistration";
import { hasRedemptionTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import { hasLoiTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kLoiTriggers";

export interface BackfillCandidate {
  readonly cik: number;
  readonly accession_number: string;
  readonly form?: string;
  readonly filing_date?: string;
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

/** Extractor version used when no slot is registered yet. */
const FALLBACK_VERSION = "1.0.0";

/**
 * The default needing-work predicate: a bulk anti-join against `extractor_runs`
 * at the active extractor version. Exported so a descriptor whose own
 * `filterTodo` only WIDENS the default can call it rather than restate it —
 * one implementation, and no import cycle back through
 * {@link runExtractorBackfill}, which imports this module.
 */
export async function defaultFilterTodo(
  extractorId: string,
  candidates: BackfillCandidate[]
): Promise<BackfillCandidate[]> {
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const activeSlot = await getActiveSlot(versionRegistry, "extractor", extractorId);
  const extractorVersion = activeSlot?.semver ?? FALLBACK_VERSION;
  return runRepo.listFilingsWithoutSuccessfulRun(candidates, extractorId, extractorVersion);
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
 * Known-SPAC filings of an extractor's routed forms, queried by `(form, cik)`
 * so only each SPAC's rows load (the filings storage is indexed on it).
 */
async function selectKnownSpacFilings(extractorId: string): Promise<BackfillCandidate[]> {
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const spacs = await new SpacRepo().getAllSpacs();
  const out: BackfillCandidate[] = [];
  for (const spac of spacs) {
    for (const form of formsForExtractor(extractorId)) {
      const filings = (await filingRepo.query({ form, cik: spac.cik })) ?? [];
      for (const f of filings) {
        out.push({
          cik: f.cik,
          accession_number: f.accession_number,
          form: f.form ?? undefined,
          filing_date: f.filing_date ?? undefined,
        });
      }
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
 * Descriptor for a known-SPAC 8-K sub-extractor (redemption / LOI).
 *
 * `filterTodo` is the default anti-join UNIONED with the filings whose detector
 * section carries the catch-all `MODEL_INVALID_OUTPUT` reason code and produced
 * no extraction row. Those recorded a SUCCESSFUL run while writing nothing —
 * the detector records the run before the section's dead letter is examined —
 * so the anti-join alone never revisits them and the failure is invisible to
 * every sweep. `MODEL_EMPTY` entries are deliberately not selected: a confident
 * negative is the expected answer for most trigger 8-Ks and must not be re-paid
 * as an AI call on every sweep.
 */
function spacTrigger8KDescriptor(
  extractorId: string,
  sectionName: string,
  hasTriggerItem: (items: string | null | undefined) => boolean,
  hasExtraction: (accession_number: string) => Promise<boolean>
): BackfillDescriptor {
  return {
    extractorId,
    selectCandidates: spacTrigger8KSelector(hasTriggerItem),
    filterTodo: async (candidates) => {
      const todo = await defaultFilterTodo(extractorId, candidates);
      const already = new Set(todo.map((c) => c.accession_number));
      const invalid = new Set(
        (await new ExtractionDeadLetterRepo().listByReasonCode(extractorId, "MODEL_INVALID_OUTPUT"))
          .filter((e) => e.section_name === sectionName)
          .map((e) => e.accession_number)
      );
      for (const c of candidates) {
        if (already.has(c.accession_number)) continue;
        // Membership first, so the per-candidate extraction lookup is paid only
        // for the corrupted set rather than for every candidate 8-K.
        if (!invalid.has(c.accession_number)) continue;
        if (await hasExtraction(c.accession_number)) continue;
        todo.push(c);
        already.add(c.accession_number);
      }
      return todo;
    },
  };
}

/**
 * Candidates for merger-proxy recovery: known-SPAC merger proxies, queried by
 * `(form, cik)` (the filings storage is indexed on it) so only each SPAC's
 * proxies load. `filterTodo` keeps those with no extraction row and no
 * dead-letter entry for the merger section: the known-SPAC gate records a
 * `success: true` no-op run when the spac row does not exist at ingestion, so
 * the default extractor-runs anti-join would never revisit them.
 *
 * The dead-letter conjunct is what makes the predicate converge. On the
 * {@link MERGER_PROXY_OPTIONAL_FORMS} an absent merger section is the expected
 * case — a `DEF 14A` reaches 575 distinct SPACs, most of them annual and
 * extension votes — and the processor deliberately writes no extraction row for
 * one. On the extraction row alone every such proxy is selected again on every
 * sweep, forever; the resolved `SECTION_NOT_FOUND` trace the processor records
 * is the evidence that it ran and had nothing to extract.
 */
const mergerProxyDescriptor: BackfillDescriptor = {
  extractorId: "merger-proxy",
  selectCandidates: () => selectKnownSpacFilings("merger-proxy"),
  filterTodo: async (candidates) => {
    const extractions = new SpacMergerExtractionRepo();
    const answered = await loadAnsweredMergerSections(candidates.map((c) => c.accession_number));
    const todo: BackfillCandidate[] = [];
    for (const c of candidates) {
      if (answered.has(c.accession_number)) continue;
      if (!(await extractions.getByAccession(c.accession_number))) todo.push(c);
    }
    return todo;
  },
};

/**
 * Candidates for Form 25/15 recovery: known-SPAC listing-withdrawal and
 * Exchange Act termination filings, plus the 20-Fs routed here so an FPI close
 * can record its completion. `filterTodo` delegates to
 * {@link listingRemovalNeedsWork}, the same predicate `sec spac process`
 * selects on: the known-SPAC gate records a `success: true` no-op when the spac
 * row does not exist at ingestion, so the default extractor-runs anti-join
 * would never revisit them after the S-1 lands. A 25-NSE shortly after IPO
 * writes `unit_split`; a close-day 25-NSE or Form 15 after a vote/proxy writes
 * `completed`. A previously recorded `deregistration` that would now classify
 * as `unit_split` or `completed` is re-selected so replay can reclassify, and a
 * filing the classifier ignores is never selected at all.
 */
const deregistrationDescriptor: BackfillDescriptor = {
  extractorId: "25-15",
  selectCandidates: () => selectKnownSpacFilings("25-15"),
  filterTodo: async (candidates) => {
    const repo = new SpacRepo();
    const eventsByCik = new Map<number, SpacEvent[]>();
    const ipoByCik = new Map<number, string | null>();
    const todo: BackfillCandidate[] = [];
    for (const c of candidates) {
      let events = eventsByCik.get(c.cik);
      if (!events) {
        events = await repo.getEvents(c.cik);
        eventsByCik.set(c.cik, events);
      }
      if (!ipoByCik.has(c.cik)) {
        ipoByCik.set(c.cik, (await repo.getSpac(c.cik))?.ipo_date ?? null);
      }
      const needsWork = await listingRemovalNeedsWork({
        cik: c.cik,
        form: c.form ?? null,
        filingDate: c.filing_date ?? null,
        accession_number: c.accession_number,
        ipoDate: ipoByCik.get(c.cik) ?? null,
        events,
      });
      if (needsWork) todo.push(c);
    }
    return todo;
  },
};

/**
 * Candidates for Form RW recovery: known-SPAC registration-withdrawal filings.
 * `filterTodo` keeps those with no `withdrawal` event: the known-SPAC gate
 * records a `success: true` no-op when the spac row does not exist at
 * ingestion, so the default extractor-runs anti-join would never revisit them
 * after the S-1 lands.
 */
const withdrawalDescriptor: BackfillDescriptor = {
  extractorId: "RW",
  selectCandidates: () => selectKnownSpacFilings("RW"),
  filterTodo: async (candidates) => {
    const repo = new SpacRepo();
    const eventsByCik = new Map<number, SpacEvent[]>();
    const todo: BackfillCandidate[] = [];
    for (const c of candidates) {
      let events = eventsByCik.get(c.cik);
      if (!events) {
        events = await repo.getEvents(c.cik);
        eventsByCik.set(c.cik, events);
      }
      if (
        events.some(
          (e) => e.event_type === "withdrawal" && e.accession_number === c.accession_number
        )
      ) {
        continue;
      }
      if (c.form === "SEC STAFF ACTION") {
        const spac = await repo.getSpac(c.cik);
        if (spac?.ipo_date != null && spac.ipo_date !== "") continue;
        if (c.filing_date && !(await staffActionAbandonsRegistration(c.cik, c.filing_date))) {
          continue;
        }
      }
      todo.push(c);
    }
    return todo;
  },
};

/** Sub-extractors and gated extractors whose candidate set is not form-derived. */
const CUSTOM_DESCRIPTORS: Readonly<Record<string, BackfillDescriptor>> = {
  redemption: spacTrigger8KDescriptor(
    "redemption",
    "redemption",
    hasRedemptionTriggerItem,
    async (accession_number) =>
      (await new SpacRedemptionExtractionRepo().getByAccession(accession_number)) !== undefined
  ),
  loi: spacTrigger8KDescriptor(
    "loi",
    "loi",
    hasLoiTriggerItem,
    async (accession_number) =>
      (await new SpacLoiExtractionRepo().getByAccession(accession_number)) !== undefined
  ),
  "merger-proxy": mergerProxyDescriptor,
  "25-15": deregistrationDescriptor,
  RW: withdrawalDescriptor,
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
