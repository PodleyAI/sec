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
  /**
   * The running task's context, threaded so a store step can report progress or
   * prefetch a resource. Undefined when a caller has none (tests, backfills).
   */
  readonly context: IExecuteContext | undefined;
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
   */
  readonly needsFullSubmission?: boolean;
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

const REGISTRY = new Map<string, FormExtractor>();

/** `id` for a whole-filing extractor, `id:section` otherwise. */
export function extractorKey(id: string, section?: string): string {
  return section === undefined || section === "" ? id : `${id}:${section}`;
}

function keyOf(ext: FormExtractor): string {
  return extractorKey(ext.id, ext.section);
}

export function registerFormExtractor<TParsed>(ext: FormExtractor<TParsed>): void {
  REGISTRY.set(keyOf(ext), ext as FormExtractor);
}

export function getFormExtractor(key: string): FormExtractor | undefined {
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
export function extractorsForForm(form: string): readonly FormExtractor[] {
  const members = [...REGISTRY.values()].filter((e) => e.forms.includes(form));
  const byKey = new Map(members.map((e) => [keyOf(e), e]));
  const sorted: FormExtractor[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (ext: FormExtractor): void => {
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

export function formNeedsFullSubmission(form: string): boolean {
  return extractorsForForm(form).some((e) => e.needsFullSubmission === true);
}

/** Test hook: drop all registrations so a test starts from an empty registry. */
export function clearFormExtractorsForTesting(): void {
  REGISTRY.clear();
}
