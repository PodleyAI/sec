/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { globalServiceRegistry } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import type { ExtractorId } from "../../storage/versioning/extractorIds";
import { EXTRACTOR_IDS } from "../../storage/versioning/extractorIds";
import {
  allRegisteredExtractorIds,
  allRegisteredForms,
  formHandledByExtractor,
} from "../../sec/forms/formExtractors";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";

/**
 * Both {@link formsForExtractor} and {@link listBackfillableExtractorIds} read
 * the form-extractor registry, and `sec extractor backfill` reaches the second
 * one while Commander is BUILDING its command tree — before the preAction hook
 * runs `bootstrapSecRuntime`. Against an empty registry the help text would
 * offer only the custom descriptors below, and a generic descriptor would find
 * no forms for an id that has them.
 *
 * `registerSecFormExtractors` registers once per registry generation, so this
 * neither duplicates the bootstrap's call nor overrides a downstream
 * package's registration under a shared key.
 */
registerSecFormExtractors();

export interface BackfillCandidate {
  readonly cik: number;
  readonly accession_number: string;
  readonly form?: string;
  readonly filing_date?: string;
}

/**
 * Per-extractor backfill wiring. A new extractor gets a generalized backfill by
 * either (a) nothing at all — every extractor registered against a form is
 * backfillable by default over the filings of its forms — or (b) one
 * descriptor contributed through {@link registerBackfillDescriptor} when its
 * candidate set is not "all filings of my forms" (sub-extractors gated on
 * trigger items, or on a row another extractor writes) or when a successful
 * `extractor_runs` row does not imply the work was done (gated no-ops that
 * record success).
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
   * Override when a recorded success can be a gated no-op — a handler that
   * finds nothing to attach to records a successful run having written nothing,
   * so its predicate has to be "no row was written" instead.
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

/**
 * All form symbols routed to the given extractor id.
 *
 * Published, because a descriptor contributed from outside this package selects
 * candidates over the forms its own registration routed here — asking the same
 * registry the generic descriptor asks rather than restating the list.
 */
export function formsForExtractor(extractorId: string): string[] {
  return allRegisteredForms().filter((form) => formHandledByExtractor(form, extractorId));
}

/**
 * Rows read per page while scanning a form's filings for backfill candidates.
 *
 * The candidate LIST is a slim `{cik, accession_number}` per filing and is
 * materialized in full by design — `selected` / `skipped` are counts over it and
 * a descriptor's `filterTodo` is handed the whole set. The full `Filing` ROWS
 * are not: at a measured ~460 bytes per 15-column row, `query({form})` over Form
 * D's corpus is several hundred MB held only to read two or three columns off
 * each row. Paging keeps that at ~5 MB while the slim list still ends up
 * complete.
 */
const BACKFILL_PAGE_SIZE = 10_000;

/** The columns a candidate selector reads off a filing row. */
interface FilingPageRow {
  readonly cik: number;
  readonly accession_number: string;
  readonly items?: string | null;
}

/**
 * Every filing of one form, one page at a time, in primary-key order.
 *
 * Keyset resume over `(cik, accession_number)`, in two queries per page for the
 * same reason {@link ComputeFormsWorklistTask.readPage} needs two:
 * `SearchCriteria` allows one condition per column and has no OR, so the exact
 * predicate `(cik, accession) > (lastCik, lastAccession)` is "the rest of this
 * CIK" followed by "later CIKs". That is what lets one filer hold more filings
 * of a form than the page size — a serial 8-K filer, a shelf issuer's 424B2s —
 * without the scan stalling on it.
 */
async function* pageFilingsOfForm(form: string): AsyncGenerator<FilingPageRow[]> {
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const orderBy = [
    { column: "cik" as const, direction: "ASC" as const },
    { column: "accession_number" as const, direction: "ASC" as const },
  ];
  let lastCik: number | undefined;
  let lastAccession: string | undefined;

  for (;;) {
    let rows: FilingPageRow[];
    if (lastCik === undefined || lastAccession === undefined) {
      rows = ((await filingRepo.query({ form } as never, {
        orderBy,
        limit: BACKFILL_PAGE_SIZE,
      })) ?? []) as FilingPageRow[];
    } else {
      const restOfCik = ((await filingRepo.query(
        {
          form,
          cik: lastCik,
          accession_number: { value: lastAccession, operator: ">" as const },
        } as never,
        { orderBy: [{ column: "accession_number", direction: "ASC" }], limit: BACKFILL_PAGE_SIZE }
      )) ?? []) as FilingPageRow[];
      const remaining = BACKFILL_PAGE_SIZE - restOfCik.length;
      const laterCiks =
        remaining > 0
          ? (((await filingRepo.query(
              { form, cik: { value: lastCik, operator: ">" as const } } as never,
              { orderBy, limit: remaining }
            )) ?? []) as FilingPageRow[])
          : [];
      rows = restOfCik.length === 0 ? laterCiks : [...restOfCik, ...laterCiks];
    }

    if (rows.length === 0) return;
    const last = rows[rows.length - 1]!;
    lastCik = last.cik;
    lastAccession = last.accession_number;
    yield rows;
    if (rows.length < BACKFILL_PAGE_SIZE) return;
  }
}

/** Candidates = every filing of the given forms, read a page at a time. */
async function selectFilingsByForms(forms: readonly string[]): Promise<BackfillCandidate[]> {
  const out: BackfillCandidate[] = [];
  for (const form of forms) {
    for await (const page of pageFilingsOfForm(form)) {
      for (const f of page) {
        out.push({ cik: f.cik, accession_number: f.accession_number });
      }
    }
  }
  return out;
}

/** Descriptors contributed by a consumer package, keyed by extractor id. */
const REGISTERED_DESCRIPTORS = new Map<string, BackfillDescriptor>();

/**
 * Contribute a backfill descriptor from the package that ships the reading
 * behind `descriptor.extractorId`.
 *
 * Registering one is the only signal this package has that a deployment can
 * actually re-run that extractor: an id whose reading lives elsewhere and whose
 * dispatch happens inside another extractor's `store` is invisible to the
 * form-extractor registry, and a gated handler that records a successful no-op
 * is invisible to the default anti-join. A contributed descriptor wins over the
 * generic form-derived one — the package that ships the reading is the
 * authority on which filings it should have read. Idempotent; last registration
 * for an id stands.
 */
export function registerBackfillDescriptor(descriptor: BackfillDescriptor): void {
  REGISTERED_DESCRIPTORS.set(descriptor.extractorId, descriptor);
}

/** Test hook: forget every contributed descriptor. */
export function clearRegisteredBackfillDescriptorsForTesting(): void {
  REGISTERED_DESCRIPTORS.clear();
}

/**
 * Resolve the backfill descriptor for an extractor id. A descriptor contributed
 * through {@link registerBackfillDescriptor} wins; any other extractor id with
 * routed forms gets the generic all-filings-of-its-forms descriptor. Returns
 * undefined for unknown / non-backfillable ids.
 */
export function getBackfillDescriptor(extractorId: string): BackfillDescriptor | undefined {
  const contributed = REGISTERED_DESCRIPTORS.get(extractorId);
  if (contributed) return contributed;
  const forms = formsForExtractor(extractorId);
  if (forms.length === 0) return undefined;
  return {
    extractorId,
    selectCandidates: () => selectFilingsByForms(forms),
  };
}

/**
 * Every extractor id `sec extractor backfill` accepts (for CLI help / errors),
 * and the set `db setup` seeds a version slot for.
 *
 * Three sources, because an id can reach an operator by three routes. The open
 * registry names whatever is registered, a downstream package's extractors
 * included. The contributed descriptors name the handlers whose candidate set
 * is not form-derived — the gated ones, and the ones that run inside another
 * extractor's `store` and register no form of their own — which only the
 * package supplying them can declare. And {@link EXTRACTOR_IDS} names what this
 * package holds STATE for — dead letters, run rows, offering and extraction
 * tables — which outlives whether it still ships the extractor that wrote them.
 * An id with rows and no version slot is unreadable: its dead letters cannot be
 * counted as eligible, `retry` cannot resolve a slot, and the version
 * ceremonies refuse it.
 *
 * Deliberately WIDER than the set that can actually be backfilled here: an id
 * this package only holds state for is listed, seeded, and then refused by name
 * when a command tries to run it.
 */
export function listBackfillableExtractorIds(): ExtractorId[] {
  const ids = new Set<string>(allRegisteredExtractorIds());
  for (const id of REGISTERED_DESCRIPTORS.keys()) ids.add(id);
  for (const id of EXTRACTOR_IDS) ids.add(id);
  return [...ids].sort() as ExtractorId[];
}
