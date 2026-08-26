/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IExecuteContext } from "workglow";

/** What every extractor's `store` receives about the filing it is storing. */
export interface FormExtractorStoreArgs {
  readonly cik: number;
  readonly file_number: string;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly primary_doc: string;
  readonly form: string;
  /**
   * The submissions-API `items` list and period-of-report, carried for the forms
   * that key on them. Null on the forms that have none, rather than absent, so a
   * reader is not left inferring which is which.
   */
  readonly items: string | undefined | null;
  readonly report_date: string | undefined | null;
  /**
   * The extractor being run and the version slot its run is recorded under.
   * Per-extractor rather than per-filing: two extractors over one form resolve
   * their own slots, and the driver has already looked both up.
   */
  readonly extractor_id: string;
  readonly extractor_version: string;
  /** The fetched document body. */
  readonly text: string;
  /** Whether `text` is the full submission rather than the primary document. */
  readonly isFullSubmission: boolean;
  /**
   * The running task's context, threaded so a store step can report progress or
   * prefetch a resource. Undefined when a caller has none (tests, backfills).
   */
  readonly context: IExecuteContext | undefined;
}

/** What a per-filing full-submission escalation gets to decide on. */
export interface FullSubmissionProbe {
  readonly form: string;
  readonly cik: number | undefined;
  readonly items: string | undefined | null;
}

/**
 * One extractor over one form family.
 *
 * A form may carry several: an 8-K's item codes and its de-SPAC milestones are
 * different questions of the same filing, with their own version slots and their
 * own failure modes. `id` plus `section` is the identity — `section` is `""`
 * until an extractor is split finely enough for a caller to address one part of
 * it, which is also how `extraction_dead_letter` already keys its rows.
 */
export interface FormExtractor<TParsed = unknown> {
  readonly id: string;
  /** Empty for a whole-filing extractor. */
  readonly section?: string;
  /** Every form symbol this handles, amendment variants included. */
  readonly forms: readonly string[];
  /**
   * Whether the body must be the full submission `.txt` rather than the primary
   * document. Taken as a union across a form's extractors: one extractor needing
   * the sibling `<DOCUMENT>` blocks escalates the fetch for all of them, and the
   * fetch is cached, so the others are unaffected.
   *
   * A predicate rather than a flag where the answer depends on the filing: an
   * 8-K is fetched whole only when it carries a redemption or letter-of-intent
   * item AND its filer is already a known SPAC, which is a storage lookup, not
   * something a form symbol can answer.
   */
  readonly needsFullSubmission?: boolean | ((probe: FullSubmissionProbe) => Promise<boolean>);
  /**
   * Whether this extractor needs the filing's document at all. Default true.
   *
   * `false` for the extractors that work from the submissions metadata alone —
   * Reg A offering-circular supplements and withdrawals, 1-U, and the listing
   * removals. Their bodies run 1-2 MB of narrative HTML apiece and carry
   * anything extractable in a minority of cases, so the driver has always
   * skipped the download for them. A form is fetched when ANY of its
   * extractors needs the document.
   */
  readonly needsDocument?: boolean;
  /** Omitted when the form's registered parser class is the right one. */
  readonly parse?: (form: string, text: string) => Promise<TParsed>;
  readonly store: (
    args: FormExtractorStoreArgs & { readonly form: string; readonly parsed: TParsed }
  ) => Promise<void>;
  /**
   * Keys this must run after, within a form. A key naming nothing registered is
   * ignored rather than fatal — that is what lets sec run its own extractors
   * when a downstream package's are absent.
   */
  readonly after?: readonly string[];
}

/**
 * `any` rather than `unknown` for the stored parse type: `store` is
 * contravariant in it, so a `FormExtractor<TParsed>` is not assignable to a
 * `FormExtractor<unknown>` and the registry could not hold heterogeneous
 * entries at all. Each registration keeps its own type at its call site; the
 * erasure is what lets differently-typed extractors share one map.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY = new Map<string, FormExtractor<any>>();

/** `id` for a whole-filing extractor, `id:section` otherwise. */
export function extractorKey(id: string, section?: string): string {
  return section === undefined || section === "" ? id : `${id}:${section}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function keyOf(ext: FormExtractor<any>): string {
  return extractorKey(ext.id, ext.section);
}

export function registerFormExtractor<TParsed>(ext: FormExtractor<TParsed>): void {
  REGISTRY.set(keyOf(ext), ext);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getFormExtractor(key: string): FormExtractor<any> | undefined {
  return REGISTRY.get(key);
}

export function listFormExtractorKeys(): readonly string[] {
  return [...REGISTRY.keys()];
}

/**
 * Every extractor registered for `form`, in an order satisfying their `after`
 * declarations. Registration order breaks ties, so a form whose extractors
 * declare nothing keeps the order they were registered in.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractorsForForm(form: string): readonly FormExtractor<any>[] {
  const members = [...REGISTRY.values()].filter((e) => e.forms.includes(form));
  const byKey = new Map(members.map((e) => [keyOf(e), e]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sorted: FormExtractor<any>[] = [];
  const state = new Map<string, "visiting" | "done">();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (ext: FormExtractor<any>): void => {
    const key = keyOf(ext);
    const seen = state.get(key);
    if (seen === "done") return;
    if (seen === "visiting") {
      throw new Error(`Form extractor cycle at '${key}' for form '${form}'`);
    }
    state.set(key, "visiting");
    for (const dep of ext.after ?? []) {
      // A dependency outside this form, or absent entirely, orders nothing.
      const target = byKey.get(dep);
      if (target !== undefined) visit(target);
    }
    state.set(key, "done");
    sorted.push(ext);
  };

  for (const ext of members) visit(ext);
  return sorted;
}

/** The de-duplicated union of every form the given extractor keys handle. */
export function formsForExtractorKeys(keys: readonly string[]): string[] {
  const out = new Set<string>();
  for (const key of keys) {
    for (const form of REGISTRY.get(key)?.forms ?? []) out.add(form);
  }
  return [...out];
}

/**
 * Whether any extractor registered for the filing's form wants the whole
 * submission. Async because an extractor may decide per filing.
 *
 * Static flags are checked before any predicate runs, so an extractor that
 * always wants the whole submission spares every other extractor's lookup —
 * whatever order they registered in. The answer is a plain OR across the form's
 * extractors, so evaluating the free half first costs nothing and can save a
 * database round trip on every filing of that form.
 */
export async function formNeedsFullSubmission(probe: FullSubmissionProbe): Promise<boolean> {
  const extractors = extractorsForForm(probe.form);
  if (extractors.some((e) => e.needsFullSubmission === true)) return true;
  for (const ext of extractors) {
    const rule = ext.needsFullSubmission;
    if (typeof rule === "function" && (await rule(probe))) return true;
  }
  return false;
}

/**
 * Whether the filing's document must be fetched and parsed. True unless every
 * extractor registered for the form opts out, since one extractor needing the
 * body means it is fetched and the rest read it for free.
 */
export function formNeedsDocument(form: string): boolean {
  const extractors = extractorsForForm(form);
  if (extractors.length === 0) return true;
  return extractors.some((e) => e.needsDocument !== false);
}

/** Test hook: drop all registrations so a test starts from an empty registry. */
export function clearFormExtractorsForTesting(): void {
  REGISTRY.clear();
}
