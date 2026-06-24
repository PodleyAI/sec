/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtractionDeadLetterRepo } from "../../../../storage/dead-letter/ExtractionDeadLetterRepo";

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
   * UNVERIFIED_SOURCE_SPAN (using `unverifiedAllDetail`); when some are
   * dropped, the surviving rows persist normally AND a "<sectionName>-partial"
   * dead-letter is recorded for triage (using `unverifiedPartialDetail`).
   * Detail strings may use `$N` (dropped count) and `$T` (confident total).
   * `NoInfer<TRow>` keeps TRow inferred solely from `extract` — without it,
   * contextual typing of the verifyRow callback's parameter would pin TRow
   * to the constraint and break the persist callback's row typing.
   */
  readonly verifyRow?: (text: string, row: NoInfer<TRow>) => boolean;
  readonly unverifiedAllDetail?: string;
  readonly unverifiedPartialDetail?: string;
  readonly extract: (text: string) => Promise<TRow[]>;
  readonly persist: (rows: TRow[]) => Promise<number>;
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

    const record = (reason: string, detail: string | null) =>
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
      const raw = await sargs.extract(sargs.text);
      const confident = raw.filter((r) => r.confidence >= floor);
      const text = sargs.text;
      const verifyRow = sargs.verifyRow;
      let rows: TRow[];
      let droppedUnverified = 0;
      if (verifyRow !== undefined && confident.length > 0) {
        rows = confident.filter((r) => verifyRow(text, r));
        droppedUnverified = confident.length - rows.length;
      } else {
        rows = confident;
      }
      if (rows.length === 0) {
        const allDroppedUnverified =
          droppedUnverified > 0 && droppedUnverified === confident.length;
        const reason = allDroppedUnverified
          ? "UNVERIFIED_SOURCE_SPAN"
          : raw.length === 0
            ? "MODEL_EMPTY"
            : "LOW_CONFIDENCE_ALL";
        const detail = allDroppedUnverified
          ? (sargs.unverifiedAllDetail ?? sargs.lowConfidenceDetail).replace(
              /\$T/g,
              String(confident.length)
            )
          : raw.length === 0
            ? sargs.emptyDetail
            : sargs.lowConfidenceDetail;
        await record(reason, detail);
        return;
      }
      const wrote = await sargs.persist(rows);
      if (sargs.invalidWriteDetail !== undefined && wrote === 0) {
        await record("MODEL_INVALID_OUTPUT", sargs.invalidWriteDetail);
      } else {
        await deadLetters.markResolved(extractor_id, accession_number, sargs.sectionName);
      }
      if (droppedUnverified > 0 && sargs.unverifiedPartialDetail !== undefined) {
        await deadLetters.record({
          extractor_id,
          accession_number,
          section_name: `${sargs.sectionName}-partial`,
          reason_code: "UNVERIFIED_SOURCE_SPAN",
          detail: sargs.unverifiedPartialDetail
            .replace(/\$N/g, String(droppedUnverified))
            .replace(/\$T/g, String(confident.length)),
          failed_extractor_version: extractor_version,
          source_run_id: null,
        });
      }
    } catch (e) {
      await record(
        "MODEL_INVALID_OUTPUT",
        (e instanceof Error ? e.message : String(e)).slice(0, 1024)
      );
    }
  };
}
