/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IExecuteContext } from "workglow";
import type { ExtractorGateVerdict } from "../../storage/versioning/ExtractorRunSchema";

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
   * The whole submission `.txt`, present only when THIS extractor declared it
   * reads one — see {@link FormExtractorCommon.readsFullSubmission}. Undefined
   * otherwise, a filing whose body was fetched whole for a SIBLING extractor
   * included: a wider fetch is a caching decision and must not widen what an
   * extractor is handed to read.
   */
  readonly fullSubmissionText: string | undefined;
  /**
   * The running task's context, threaded so a store step can report progress or
   * prefetch a resource. Undefined when a caller has none (tests, backfills).
   */
  readonly context: IExecuteContext | undefined;
}

/**
 * What a `store` reports back about its OWN admission gate.
 *
 * Several handlers are gated on a row they did not write — a known-SPAC check
 * against `spac` — and return early having written nothing, while the dispatcher
 * still records a SUCCESSFUL run for them, because a recorded successful run is
 * what stops a filing being re-selected. That the gate declined survived
 * nowhere, so nothing could tell "ran and had nothing to write" from "declined
 * before looking".
 *
 * A `store` with a gate returns this to say which it was; the dispatcher stamps
 * it on the `extractor_runs` row it writes for that extractor. Returning
 * nothing is the honest answer for a handler with no gate: the column stays
 * null, meaning NOT RECORDED, and never `admitted`.
 *
 * An object rather than the bare string so a `store` cannot report a verdict by
 * accident — the value has to be built on purpose.
 */
export interface FormExtractorStoreReport {
  readonly gate: ExtractorGateVerdict;
}

/** What a per-filing full-submission escalation gets to decide on. */
export interface FullSubmissionProbe {
  readonly form: string;
  readonly cik: number | undefined;
  readonly items: string | undefined | null;
}

/**
 * Fields every extractor declares, regardless of whether it reads the filing's
 * document. Split out from {@link FormExtractor} so `store`'s shape — the part
 * that differs — can be discriminated on `needsDocument` instead of living on
 * one interface that is truthful for only half its instances.
 */
interface FormExtractorCommon<TParsed> {
  readonly id: string;
  /** Empty for a whole-filing extractor. */
  readonly section?: string;
  /** Every form symbol this handles, amendment variants included. */
  readonly forms: readonly string[];
  /**
   * WHICH FILE IS FETCHED: the full submission `.txt` rather than the primary
   * document. One file is fetched per filing, so this is taken as a union
   * across the form's extractors — one extractor needing the sibling
   * `<DOCUMENT>` blocks escalates the fetch for all of them, and the fetch is
   * cached, so the others read the wider file for free.
   *
   * A predicate rather than a flag where which file to fetch depends on the
   * filing rather than on its form symbol alone.
   *
   * Says nothing about what any extractor is then handed — that is
   * {@link readsFullSubmission}.
   */
  readonly needsFullSubmission?: boolean | ((probe: FullSubmissionProbe) => Promise<boolean>);
  /**
   * WHAT THIS EXTRACTOR SEES: whether its `store` receives the whole
   * submission as {@link FormExtractorStoreArgs.fullSubmissionText}.
   *
   * Deliberately NOT unioned across a form's extractors. Two extractors over
   * one filing may legitimately read different things, and widening what one
   * of them reads is a change in its answers — an 8-K's narrative passes read
   * the EX-99 exhibits only for a known SPAC carrying a redemption or
   * letter-of-intent item, which is a storage lookup, not something a form
   * symbol can answer. Widening a fetch costs a download; widening this
   * changes what is extracted.
   *
   * Satisfied only from a body that was actually fetched whole, so declaring
   * it without {@link needsFullSubmission} also being true for the form hands
   * the extractor nothing.
   */
  readonly readsFullSubmission?: boolean | ((probe: FullSubmissionProbe) => Promise<boolean>);
  /**
   * Parses this extractor's own reading of the fetched document, in place of
   * the form's shared parse (the registered `ALL_FORMS_MAP` class). Omitted
   * when that shared parse is already the right one — every extractor sec
   * ships today. With one extractor per form this changes nothing: the shared
   * parse runs once and every extractor's `store` sees it. Once a form carries
   * two, each with its own `parse`, they read the same document
   * independently instead of being stuck sharing one parser's output.
   *
   * A form whose every document-reading extractor declares one needs no
   * registered parser class at all — the shared parse is computed only where
   * some extractor would actually read it.
   */
  readonly parse?: (form: string, text: string) => Promise<TParsed>;
  /**
   * Keys this must run after, within a form. A key naming nothing registered is
   * ignored rather than fatal — that is what lets sec run its own extractors
   * when a downstream package's are absent.
   */
  readonly after?: readonly string[];
}

/** An extractor that reads the filing's document (the default). */
export interface FormExtractorWithDocument<TParsed = unknown> extends FormExtractorCommon<TParsed> {
  readonly needsDocument?: true;
  readonly store: (
    args: FormExtractorStoreArgs & { readonly form: string; readonly parsed: TParsed }
  ) => Promise<FormExtractorStoreReport | void>;
}

/**
 * An extractor that works from the submissions metadata alone —
 * Reg A offering-circular supplements and withdrawals, 1-U, and the listing
 * removals. Their bodies run 1-2 MB of narrative HTML apiece and carry
 * anything extractable in a minority of cases, so the driver has always
 * skipped the download for them. A form is fetched when ANY of its
 * extractors needs the document.
 *
 * `store` here is never handed a `parsed` field. Nothing was fetched for this
 * extractor to read, so a downstream `store` that tries to dereference one
 * fails to compile instead of dereferencing `undefined` at runtime.
 */
export interface FormExtractorMetadataOnly<TParsed = unknown> extends FormExtractorCommon<TParsed> {
  readonly needsDocument: false;
  readonly store: (
    args: FormExtractorStoreArgs & { readonly form: string }
  ) => Promise<FormExtractorStoreReport | void>;
}

/**
 * One extractor over one form family.
 *
 * A form may carry several: an 8-K's item codes and its de-SPAC milestones are
 * different questions of the same filing, with their own version slots and their
 * own failure modes. `id` plus `section` is the identity — `section` is `""`
 * until an extractor is split finely enough for a caller to address one part of
 * it, which is also how `extraction_dead_letter` already keys its rows.
 *
 * A union on `needsDocument` rather than one interface: see
 * {@link FormExtractorWithDocument} and {@link FormExtractorMetadataOnly}.
 */
export type FormExtractor<TParsed = unknown> =
  FormExtractorWithDocument<TParsed> | FormExtractorMetadataOnly<TParsed>;

/**
 * `any` rather than `unknown` for the stored parse type: `store` is
 * contravariant in it, so a `FormExtractor<TParsed>` is not assignable to a
 * `FormExtractor<unknown>` and the registry could not hold heterogeneous
 * entries at all. Each registration keeps its own type at its call site; the
 * erasure is what lets differently-typed extractors share one map.
 */
const REGISTRY = new Map<string, FormExtractor<any>>();

/**
 * Bumped every time the registry is emptied. A package that registers a fixed
 * set of extractors reads this to tell "I have already registered into THIS
 * registry" from "the registry was cleared out from under me", which is what
 * lets such a call be idempotent without a flag of its own that a clear cannot
 * reach.
 */
let generation = 0;

export function formExtractorRegistryGeneration(): number {
  return generation;
}

/** `id` for a whole-filing extractor, `id:section` otherwise. */
export function extractorKey(id: string, section?: string): string {
  return section === undefined || section === "" ? id : `${id}:${section}`;
}

function keyOf(ext: FormExtractor<any>): string {
  return extractorKey(ext.id, ext.section);
}

/**
 * Memoized {@link extractorsForForm} answers, cleared by any registration and
 * by {@link clearFormExtractorsForTesting}.
 *
 * The answer is a scan of the whole registry plus a topological sort, and the
 * dispatch path asks it three times per filing (which body to fetch, whether to
 * fetch at all, and who to store through) on top of once per form in the
 * worklist. Nothing else changes it between those calls, so recomputing it is
 * pure repeated work on every filing of every sweep.
 */
const formCache = new Map<string, readonly FormExtractor<any>[]>();

export function registerFormExtractor<TParsed>(ext: FormExtractor<TParsed>): void {
  REGISTRY.set(keyOf(ext), ext);
  formCache.clear();
}

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
export function extractorsForForm(form: string): readonly FormExtractor<any>[] {
  const cached = formCache.get(form);
  if (cached !== undefined) return cached;
  const members = [...REGISTRY.values()].filter((e) => e.forms.includes(form));
  const byKey = new Map(members.map((e) => [keyOf(e), e]));
  const sorted: FormExtractor<any>[] = [];
  const state = new Map<string, "visiting" | "done">();

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
  formCache.set(form, sorted);
  return sorted;
}

/**
 * Every distinct extractor id registered for `form`, in the order
 * {@link extractorsForForm} runs them. Empty for a form nothing handles, so a
 * caller reads a length rather than distinguishing an absent answer from an
 * empty one.
 *
 * IDS, NOT REGISTRY KEYS. The registry is keyed `(id, section)`, so one
 * extractor split into sections holds several keys — and a key carries a
 * section the caller never asked about. Every id here appears once however many
 * sections it registered under; a caller that wants the sections asks
 * {@link extractorsForForm}.
 */
export function extractorIdsForForm(form: string): readonly string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const ext of extractorsForForm(form)) {
    if (seen.has(ext.id)) continue;
    seen.add(ext.id);
    ids.push(ext.id);
  }
  return ids;
}

/** Whether any extractor is registered for `form`. */
export function formHasExtractor(form: string): boolean {
  return extractorsForForm(form).length > 0;
}

/**
 * Whether the extractor `id` handles `form` — membership, not equality with
 * whichever extractor happens to be first. A form may carry several, and the
 * one asked about is rarely the one at the front.
 */
export function formHandledByExtractor(form: string, id: string): boolean {
  return extractorsForForm(form).some((ext) => ext.id === id);
}

/**
 * Every distinct extractor id in the registry, deduped across sections — the
 * ids {@link extractorIdsForForm} answers with, not the keys
 * {@link listFormExtractorKeys} answers with.
 */
export function allRegisteredExtractorIds(): readonly string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const ext of REGISTRY.values()) {
    if (seen.has(ext.id)) continue;
    seen.add(ext.id);
    ids.push(ext.id);
  }
  return ids;
}

/** Every distinct form symbol any registered extractor handles. */
export function allRegisteredForms(): readonly string[] {
  const seen = new Set<string>();
  const forms: string[] = [];
  for (const ext of REGISTRY.values()) {
    for (const form of ext.forms) {
      if (seen.has(form)) continue;
      seen.add(form);
      forms.push(form);
    }
  }
  return forms;
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
 * The de-duplicated union of every form the given extractor IDS handle.
 *
 * The id-keyed twin of {@link formsForExtractorKeys}. The registry is keyed
 * `(id, section)`, so an extractor split into sections holds several keys and
 * a caller naming the extractor cannot know which of them to ask for. Matching
 * on the id answers for all of them, and a form handled by two extractors is
 * named once whichever of them was asked about.
 */
export function formsForExtractorIds(ids: readonly string[]): string[] {
  const want = new Set(ids);
  const out = new Set<string>();
  for (const ext of REGISTRY.values()) {
    if (!want.has(ext.id)) continue;
    for (const form of ext.forms) out.add(form);
  }
  return [...out];
}

/**
 * Whether the filing's body is fetched as the whole submission `.txt`: the
 * union of {@link FormExtractorCommon.needsFullSubmission} across the form's
 * extractors. Async because an extractor may decide per filing.
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
 * Whether ONE extractor's `store` is handed the whole submission text for this
 * filing.
 *
 * Per extractor and never unioned, which is the whole difference from
 * {@link formNeedsFullSubmission}: that settles one fetch for the filing, this
 * settles one extractor's input.
 */
export async function extractorReadsFullSubmission(
  extractor: FormExtractor<any>,
  probe: FullSubmissionProbe
): Promise<boolean> {
  const rule = extractor.readsFullSubmission;
  if (typeof rule === "function") return await rule(probe);
  return rule === true;
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
  formCache.clear();
  generation++;
}
