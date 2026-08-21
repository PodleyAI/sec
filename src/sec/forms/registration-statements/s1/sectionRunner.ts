/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskAbortedError } from "workglow";
import { DETERMINISTIC_MODEL_ID } from "../../../../config/Constants";
import type { ExtractionDeadLetterRepo } from "../../../../storage/dead-letter/ExtractionDeadLetterRepo";
import type { DeadLetterReasonCode } from "../../../../storage/dead-letter/ExtractionDeadLetterSchema";
import { SecCliConfigurationError } from "../../../../config/EnvToDI";
import type { DeterministicPass } from "./deterministicPass";
import { assertsCompletePopulation, preempts } from "./deterministicPass";
import {
  MixedRiskCaptionShapeError,
  NonceMismatchError,
  RateLimitExhaustedError,
} from "./sectionExtractors";
import type { SpanVerdict } from "./verifySourceSpan";

/**
 * Parse a confidence-floor env value. Undefined, empty, or non-numeric input
 * falls back to `fallback` — `Number` would otherwise coerce these to `0`
 * (disabling the floor, admitting every row) or `NaN` (which, since
 * `confidence >= NaN` is always false, silently drops every row).
 */
export function parseConfidenceFloor(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const REJECTED_SPAN_DETAIL_CHARS = 300;

/**
 * Append the first rejected `source_span` onto an UNVERIFIED_SOURCE_SPAN
 * detail so the worklist carries the quote that failed — the next fixture
 * can be that span, not a guess at why the section wiped.
 */
function rejectedSourceSpanSuffix(rows: readonly object[]): string {
  for (const row of rows) {
    const span = (row as { source_span?: unknown }).source_span;
    if (typeof span !== "string" || span.length === 0) continue;
    const shown =
      span.length > REJECTED_SPAN_DETAIL_CHARS
        ? `${span.slice(0, REJECTED_SPAN_DETAIL_CHARS)}…`
        : span;
    return ` rejected source_span: ${JSON.stringify(shown)}`;
  }
  return "";
}

/** Shared default floor (S-1 / 424); merger-proxy overrides via makeRunSection. */
export const CONFIDENCE_FLOOR = parseConfidenceFloor(process.env.SEC_S1_CONFIDENCE_FLOOR, 0);

/**
 * Times a section is re-asked when every confident row fails span verification.
 * Distinct from the extractor's own transport/schema retry: this one answers a
 * well-formed response whose citations do not hold up.
 *
 * These retries COMPOSE with the ones inside the extractor, and the product is
 * not obvious from either site alone. This loop wraps `sargs.extract`, which for
 * risk factors is `extractRiskFactors` — itself one call per chunk, each
 * internally retried up to `EXTRACTION_ATTEMPTS` (3) times. The worst case is
 * therefore `VERIFICATION_ATTEMPTS x EXTRACTION_ATTEMPTS x chunks`: a 246k-char
 * risk-factors section (7 chunks) whose citations verify badly can cost ~63
 * model calls before the section dead-letters. Raising either constant
 * multiplies, it does not add.
 *
 * A mixed caption shape re-asks on its own, smaller budget
 * ({@link MIXED_SHAPE_REASK_ATTEMPTS}), so that path's worst case is 42 calls
 * for the same section rather than 63.
 */
export const VERIFICATION_ATTEMPTS = 3;

/**
 * Times a section is re-asked after a {@link MixedRiskCaptionShapeError}.
 * Deliberately smaller than {@link VERIFICATION_ATTEMPTS}, because the two
 * re-asks are betting on different things. A failed span verification re-asks a
 * MALFORMED CITATION, and malformed citations are empirically unstable run to
 * run — three consecutive live runs of one section produced three different
 * spans for the same correct row, so extra attempts genuinely buy answers. A
 * mixed shape re-asks for a re-classification of a byte-identical prompt under
 * greedy decoding (`getExtractionTemperature()` defaults to 0, the nonce is off
 * by default, and the extraction is not cacheable), so the only source of
 * variation is provider-side batching. A third roll of that die is much less
 * likely to differ from the second than in the citation case, and each roll on
 * this path costs a full chunked enumeration of the largest section in the
 * filing.
 */
export const MIXED_SHAPE_REASK_ATTEMPTS = 2;

export interface RunSectionArgs<TRow extends { confidence: number }> {
  readonly sectionName: string;
  readonly text: string | undefined;
  readonly skip?: boolean;
  readonly notFoundDetail?: string | null;
  readonly emptyDetail: string;
  readonly lowConfidenceDetail: string;
  /**
   * When set, a persist that writes 0 of N rows (e.g. all underwriter/sponsor
   * rows had blank names) dead-letters MODEL_INVALID_OUTPUT. Omit for sections
   * whose persist always writes every confident row, so they always markResolved.
   */
  readonly invalidWriteDetail?: string;
  /**
   * Optional row-level verification applied AFTER the confidence floor. When
   * every confident row is dropped, the section dead-letters as
   * UNVERIFIED_SOURCE_SPAN — or SOURCE_SPAN_TOO_LONG when every drop was an
   * over-cap span (using `unverifiedAllDetail`); when some are
   * dropped, the surviving rows persist normally AND a "<sectionName>-partial"
   * dead-letter is recorded for triage (using `unverifiedPartialDetail`).
   * Detail strings may use `$N` (dropped count) and `$T` (confident total).
   *
   * Returning a {@link SpanVerdict} rather than a boolean is what lets the
   * dead letter name the actual cause; `true`/`false` remain accepted for
   * callbacks that verify something other than a span.
   * `NoInfer<TRow>` keeps TRow inferred solely from `extract` — without it,
   * contextual typing of the verifyRow callback's parameter would pin TRow
   * to the constraint and break the persist callback's row typing.
   */
  readonly verifyRow?: (text: string, row: NoInfer<TRow>) => boolean | SpanVerdict;
  readonly unverifiedAllDetail?: string;
  readonly unverifiedPartialDetail?: string;
  readonly extract: (text: string) => Promise<TRow[]>;
  /**
   * Every destination {@link persist} rewrites for this section: rows cleared
   * before the run, or overwritten in place.
   *
   * This is the set a {@link deterministic} pass must cover before it may stand
   * in for the model, and it is declared HERE because this is the side that
   * knows what `persist` writes. It used to be stated twice — once here and
   * once on `modelExtractChain` — with only the chain's copy read, so a section
   * could describe two different sets of destinations and the one that gated
   * preemption was the one nobody was reading. Undeclared means no pass may
   * preempt: a caller that has not said what the section rewrites has not shown
   * a parse can supply it.
   */
  readonly clears?: ReadonlySet<string>;
  /**
   * Tried in order when {@link extract} (and any earlier fallback) returns `[]`
   * **or throws** a provider/extraction error. Abort, an already-aborted
   * signal, {@link SecCliConfigurationError}, and {@link MixedRiskCaptionShapeError}
   * still fail immediately — mixed-shape re-asks stay on the model that threw.
   * Span-verification re-asks stay on the model that produced rows. Fallbacks
   * do not consume {@link VERIFICATION_ATTEMPTS}.
   */
  readonly emptyExtracts?: readonly ((text: string) => Promise<TRow[]>)[];
  /**
   * When false, {@link emptyExtracts} run only if {@link extract} throws — not
   * when it returns `[]`. 8-K detectors (redemption / LOI) use this: empty is
   * the expected negative, and falling through would re-pay a second model on
   * every non-event 8-K (and can turn a clean MODEL_EMPTY into grok
   * MODEL_INVALID_OUTPUT). Default true: S-1 empty is a miss worth retrying.
   */
  readonly fallbackOnEmpty?: boolean;
  /** Ids tried for this section; named in the MODEL_EMPTY detail when length > 1. */
  readonly modelIds?: readonly string[];
  /**
   * The model-free parse behind a `deterministic` slot in {@link modelIds}.
   *
   * The runner owns both halves of the preemption test: `covers` against
   * {@link clears} before the walk runs, and {@link DeterministicPass.complete}
   * against the rows it produced afterwards — which is also what
   * `SectionPersistMeta.complete` reports. Absent, a `deterministic` slot
   * yields nothing and the section falls through to the next model.
   */
  readonly deterministic?: DeterministicPass<NoInfer<TRow>>;
  readonly persist: (rows: TRow[], meta: SectionPersistMeta) => Promise<number>;
}

/**
 * Facts about the filtering that happened between extraction and persist.
 * `complete` is true only when every extracted row survived the confidence
 * floor and span verification — the only state in which the persisted rows can
 * be treated as the section's complete population (e.g. for roster closure).
 */
export interface SectionPersistMeta {
  readonly complete: boolean;
  /** 0 = primary {@link RunSectionArgs.extract}; 1+ = {@link RunSectionArgs.emptyExtracts} index + 1. */
  readonly modelIndex: number;
  /**
   * Which path produced the rows. `"deterministic"` means the winning list
   * slot was the reserved `deterministic` id and no model was called, so persist
   * callbacks record the provenance model id from this, never from a field on a
   * row.
   */
  readonly source: "deterministic" | "model";
}

export type RunSection = <TRow extends { confidence: number }>(
  sargs: RunSectionArgs<TRow>
) => Promise<void>;

/**
 * Builds the shared per-section ceremony bound to one filing + extractor:
 * resolve text, dead-letter when absent, run the extractor, apply the
 * confidence floor, persist surviving rows, and emit the resolved / empty /
 * low-confidence / invalid-output dead letters. Every AI-extracted prospectus
 * section (S-1 and 424 alike) funnels through here so the policy lives in
 * exactly one place.
 *
 * The returned `runSection` contains every extraction failure as a dead letter
 * with ONE exception: cooperative cancellation propagates. See the catch block
 * for why, and note that callers wrapping it in their own try/catch must not
 * swallow a {@link TaskAbortedError}.
 */
export function makeRunSection(opts: {
  readonly deadLetters: ExtractionDeadLetterRepo;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly accession_number: string;
  readonly confidenceFloor?: number;
  /**
   * The filing pipeline's abort signal. Used only to classify a failure that
   * arrives while cancellation is already in flight: a provider call torn down
   * mid-abort reports whatever transport error it happened to hit, and
   * recording that as an extraction failure stamps a version-gated dead letter
   * on a section that was merely interrupted.
   */
  readonly signal?: AbortSignal;
}): RunSection {
  const { deadLetters, extractor_id, extractor_version, accession_number } = opts;
  const floor = opts.confidenceFloor ?? CONFIDENCE_FLOOR;

  return async function runSection<TRow extends { confidence: number }>(
    sargs: RunSectionArgs<TRow>
  ): Promise<void> {
    if (sargs.skip) return;

    const record = (reason: DeadLetterReasonCode, detail: string | null) =>
      deadLetters.record({
        extractor_id,
        accession_number,
        section_name: sargs.sectionName,
        reason_code: reason,
        detail,
        failed_extractor_version: extractor_version,
        source_run_id: null,
      });

    if (sargs.text === undefined || sargs.text.trim() === "") {
      await record("SECTION_NOT_FOUND", sargs.notFoundDetail ?? null);
      return;
    }

    try {
      const text = sargs.text;
      const verifyRow = sargs.verifyRow;
      let raw: TRow[] = [];
      let confident: TRow[] = [];
      let rows: TRow[] = [];
      let droppedUnverified = 0;
      // Over-cap drops are tracked separately so an all-dropped section can say
      // which of the two failure modes it hit — they need opposite fixes.
      let droppedTooLong = 0;

      // Re-ask when EVERY confident row failed span verification. The rows are
      // usually right and only the citation is malformed, and the malformation
      // is not stable: three consecutive live runs of the Churchill XII
      // underwriting section produced a 99-char verbatim span (accepted), a
      // 317-char span stitched across a gap, and a 2563-char span over the cap
      // — the same correct underwriter each time. Without a re-ask the section
      // is lost about two runs in three; the rest of the pipeline already
      // retries transport-level failures for the same reason.
      // Counted separately from the loop index: the mixed-shape re-ask has its
      // own, smaller budget, and an attempt spent on one question must not
      // spend the other's.
      let mixedShapeAttempts = 0;
      let modelIndex = 0;
      const slots: ReadonlyArray<(text: string) => Promise<TRow[]>> = [
        sargs.extract,
        ...(sargs.emptyExtracts ?? []),
      ];
      const fallbackOnEmpty = sargs.fallbackOnEmpty !== false;
      const isImmediateExtractFailure = (e: unknown): boolean =>
        e instanceof TaskAbortedError ||
        e instanceof SecCliConfigurationError ||
        e instanceof MixedRiskCaptionShapeError ||
        opts.signal?.aborted === true;
      const isWalkSlot = (i: number): boolean => sargs.modelIds?.[i] === DETERMINISTIC_MODEL_ID;
      const applyRowFilters = (incoming: TRow[]): void => {
        raw = incoming;
        confident = raw.filter((r) => r.confidence >= floor);
        droppedUnverified = 0;
        droppedTooLong = 0;
        if (verifyRow !== undefined && confident.length > 0) {
          rows = confident.filter((r) => {
            const verdict = verifyRow(text, r);
            if (verdict === true || verdict === "ok") return true;
            if (verdict === "too-long") droppedTooLong++;
            return false;
          });
          droppedUnverified = confident.length - rows.length;
        } else {
          rows = confident;
        }
      };
      const clearSlot = (): void => {
        raw = [];
        confident = [];
        rows = [];
        droppedUnverified = 0;
        droppedTooLong = 0;
      };
      let source: "deterministic" | "model" = "model";
      let walkComplete = false;
      let lastError: unknown;
      for (let i = 0; i < slots.length; i++) {
        const extractFn = slots[i]!;
        modelIndex = i;
        if (isWalkSlot(i)) {
          const pass = sargs.deterministic;
          // The COLUMN half of the preemption test, and it is answerable before
          // the walk runs — a parse that cannot supply every destination
          // `persist` rewrites never reads the section at all.
          if (pass === undefined || !preempts(pass, sargs.clears, text)) {
            clearSlot();
            continue;
          }
          try {
            applyRowFilters(await extractFn(text));
            lastError = undefined;
          } catch (e) {
            if (isImmediateExtractFailure(e)) throw e;
            lastError = e;
            clearSlot();
            continue;
          }
          // The ROW half: covering the columns says nothing about having found
          // every row, and the caller has already cleared the destination.
          const complete = assertsCompletePopulation(pass, rows, text);
          if (complete && raw.length > 0 && rows.length === raw.length) {
            source = "deterministic";
            walkComplete = true;
            lastError = undefined;
            break;
          }
          clearSlot();
          continue;
        }
        mixedShapeAttempts = 0;
        let slotFailed = false;
        for (let attempt = 1; attempt <= VERIFICATION_ATTEMPTS; attempt++) {
          try {
            applyRowFilters(await extractFn(text));
            lastError = undefined;
            slotFailed = false;
          } catch (e) {
            if (e instanceof MixedRiskCaptionShapeError) {
              mixedShapeAttempts++;
              if (mixedShapeAttempts >= MIXED_SHAPE_REASK_ATTEMPTS) {
                e.message = `${e.message} (unchanged after ${mixedShapeAttempts} attempt(s))`;
                throw e;
              }
              continue;
            }
            if (isImmediateExtractFailure(e)) throw e;
            lastError = e;
            slotFailed = true;
            clearSlot();
            break;
          }
          if (rows.length > 0 || droppedUnverified !== confident.length || confident.length === 0) {
            break;
          }
        }
        if (rows.length > 0) {
          source = "model";
          lastError = undefined;
          break;
        }
        if (droppedUnverified > 0 && droppedUnverified === confident.length) {
          lastError = undefined;
          break;
        }
        if (raw.length > 0) {
          lastError = undefined;
          break;
        }
        if (!fallbackOnEmpty && !slotFailed) {
          break;
        }
      }
      if (lastError !== undefined && rows.length === 0 && raw.length === 0) {
        throw lastError;
      }
      if (rows.length === 0) {
        const allDroppedUnverified =
          droppedUnverified > 0 && droppedUnverified === confident.length;
        // Only when EVERY drop was over-cap: a mixed section still reports
        // UNVERIFIED_SOURCE_SPAN, since some rows really were not in the text.
        const allTooLong = allDroppedUnverified && droppedTooLong === droppedUnverified;
        const reason = allDroppedUnverified
          ? allTooLong
            ? "SOURCE_SPAN_TOO_LONG"
            : "UNVERIFIED_SOURCE_SPAN"
          : raw.length === 0
            ? "MODEL_EMPTY"
            : "LOW_CONFIDENCE_ALL";
        const detail = allDroppedUnverified
          ? allTooLong
            ? `all ${confident.length} confident rows had source_span over the section's length cap (the spans verify verbatim; the model quoted more than the cap allows)`
            : `${(sargs.unverifiedAllDetail ?? sargs.lowConfidenceDetail).replace(
                /\$T/g,
                String(confident.length)
              )}${rejectedSourceSpanSuffix(confident)}`
          : raw.length === 0
            ? sargs.modelIds !== undefined && sargs.modelIds.length > 1
              ? `${sargs.emptyDetail} (tried ${sargs.modelIds.join(", ")})`
              : sargs.emptyDetail
            : sargs.lowConfidenceDetail;
        await record(reason, detail);
        return;
      }
      const wrote = await sargs.persist(rows, {
        // On the deterministic path `raw` is already the parser's surviving
        // output, so counting it would report every parse as complete. The
        // pass says so itself, or it does not say so at all.
        complete: source === "deterministic" ? walkComplete : rows.length === raw.length,
        modelIndex,
        source,
      });
      if (sargs.invalidWriteDetail !== undefined && wrote === 0) {
        await record("MODEL_INVALID_OUTPUT", sargs.invalidWriteDetail);
        return;
      }
      await deadLetters.markResolved(extractor_id, accession_number, sargs.sectionName);
      // Reconcile the sibling `-partial` triage entry (only sections that can
      // emit one carry unverifiedPartialDetail). Record it when THIS run dropped
      // unverified rows; otherwise resolve any `-partial` left pending by a
      // prior run, so a now-clean filing stops lingering forever on the
      // version-gated retry worklist (markResolved no-ops when none exists).
      if (sargs.unverifiedPartialDetail !== undefined) {
        const partialSection = `${sargs.sectionName}-partial`;
        if (droppedUnverified > 0) {
          await deadLetters.record({
            extractor_id,
            accession_number,
            section_name: partialSection,
            reason_code:
              droppedTooLong === droppedUnverified
                ? "SOURCE_SPAN_TOO_LONG"
                : "UNVERIFIED_SOURCE_SPAN",
            detail:
              sargs.unverifiedPartialDetail
                .replace(/\$N/g, String(droppedUnverified))
                .replace(/\$T/g, String(confident.length)) +
              (droppedTooLong > 0 ? ` (${droppedTooLong} over the length cap)` : ""),
            failed_extractor_version: extractor_version,
            source_run_id: null,
          });
        } else {
          await deadLetters.markResolved(extractor_id, accession_number, partialSection);
        }
      }
    } catch (e) {
      // Three escapes run ahead of the reason-code mapping, in this order.
      //
      // Cooperative cancellation is not an extraction failure and must reach
      // the filing pipeline, which abandons the filing rather than recording
      // one:
      //   - the first branch keys on the error TYPE, so a genuine schema
      //     failure is never rethrown by it;
      //   - the second only fires when the signal is ALREADY aborted, where the
      //     pipeline abandons the filing regardless of what this section did,
      //     and it keeps the original error as `cause` so nothing is lost.
      //
      // Cancellation is checked BEFORE the configuration escape because the
      // aborted-signal branch is deliberately type-blind: once Ctrl-C is in
      // flight, whatever error a torn-down provider call happens to surface is
      // an artifact of the teardown, not a verdict about the section. Both
      // escapes rethrow, so neither can be swallowed into a dead letter either
      // way — the ordering only decides which error the pipeline sees, and
      // during an abort the honest answer is "the operator cancelled", with the
      // original preserved as `cause`.
      if (e instanceof TaskAbortedError) throw e;
      if (opts.signal?.aborted === true) {
        const aborted = new TaskAbortedError();
        aborted.cause = e;
        throw aborted;
      }
      // A configuration error is not an extraction failure: the value is wrong
      // for every section of every filing, so recording it would stamp a
      // version-gated dead letter across the whole corpus that no version bump
      // can clear. Let it reach the operator instead. (The CLI validates the
      // same knob at startup; this covers a library consumer that never runs
      // that hook.)
      if (e instanceof SecCliConfigurationError) throw e;
      // A NonceMismatchError is a defense-in-depth signal that the model's
      // structured response did not echo back the per-call verification token;
      // record it under a dedicated reason code so an operator can triage
      // nonce-check failures separately from generic invalid-output cases.
      // A MixedRiskCaptionShapeError is likewise its own triage class: the
      // response was well-formed, and what failed is the section's shape.
      // A RateLimitExhaustedError is not an extractor bug at all — the call
      // never ran — so it is recorded transiently and stays retry-eligible
      // under the same version.
      const reason: DeadLetterReasonCode =
        e instanceof NonceMismatchError
          ? "NONCE_MISMATCH"
          : e instanceof MixedRiskCaptionShapeError
            ? "MIXED_CAPTION_SHAPE"
            : e instanceof RateLimitExhaustedError
              ? "RATE_LIMITED"
              : "MODEL_INVALID_OUTPUT";
      await record(reason, (e instanceof Error ? e.message : String(e)).slice(0, 1024));
    }
  };
}
