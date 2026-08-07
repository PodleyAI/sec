/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtractionDeadLetterRepo } from "../../../../storage/dead-letter/ExtractionDeadLetterRepo";
import type { DeadLetterReasonCode } from "../../../../storage/dead-letter/ExtractionDeadLetterSchema";
import { MixedRiskCaptionShapeError, NonceMismatchError } from "./sectionExtractors";
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
 */
export const VERIFICATION_ATTEMPTS = 3;

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
 */
export function makeRunSection(opts: {
  readonly deadLetters: ExtractionDeadLetterRepo;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly accession_number: string;
  readonly confidenceFloor?: number;
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
      for (let attempt = 1; attempt <= VERIFICATION_ATTEMPTS; attempt++) {
        raw = await sargs.extract(text);
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
        // Only a total verification wipeout is worth re-asking. An empty or
        // all-low-confidence response is a judgement about the text rather
        // than a malformed citation, and re-rolling it just burns calls.
        if (rows.length > 0 || droppedUnverified !== confident.length || confident.length === 0) {
          break;
        }
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
            : (sargs.unverifiedAllDetail ?? sargs.lowConfidenceDetail).replace(
                /\$T/g,
                String(confident.length)
              )
          : raw.length === 0
            ? sargs.emptyDetail
            : sargs.lowConfidenceDetail;
        await record(reason, detail);
        return;
      }
      const wrote = await sargs.persist(rows, { complete: rows.length === raw.length });
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
            reason_code: droppedTooLong === droppedUnverified
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
      // A NonceMismatchError is a defense-in-depth signal that the model's
      // structured response did not echo back the per-call verification token;
      // record it under a dedicated reason code so an operator can triage
      // nonce-check failures separately from generic invalid-output cases.
      // A MixedRiskCaptionShapeError is likewise its own triage class: the
      // response was well-formed, and what failed is the section's shape.
      const reason: DeadLetterReasonCode =
        e instanceof NonceMismatchError
          ? "NONCE_MISMATCH"
          : e instanceof MixedRiskCaptionShapeError
            ? "MIXED_CAPTION_SHAPE"
            : "MODEL_INVALID_OUTPUT";
      await record(reason, (e instanceof Error ? e.message : String(e)).slice(0, 1024));
    }
  };
}
