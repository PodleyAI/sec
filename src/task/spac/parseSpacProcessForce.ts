/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { listBackfillableExtractorIds } from "../forms/backfillDescriptors";
import type { ExtractorId } from "../../storage/versioning/extractorIds";

export type SpacProcessForce =
  | { readonly kind: "none" }
  | { readonly kind: "all" }
  | { readonly kind: "extractors"; readonly ids: readonly ExtractorId[] };

/**
 * Parse Commander `--force [extractors]`: omitted/false → none, bare true /
 * empty / `all` → all extractors, otherwise a comma-separated extractor-id list.
 *
 * Ids are checked against {@link listBackfillableExtractorIds}, the same
 * vocabulary `sec extractor backfill` names — the open form-extractor registry,
 * the gated handlers whose descriptors this package ships, the descriptors a
 * consumer contributes for readings that register no form of their own, and the
 * ids this package holds state for. A closed list here refused every extractor
 * registered through that seam, so the two commands disagreed about what an
 * extractor is.
 *
 * Read per call rather than snapshotted at module load: the registry is filled
 * by the runtime bootstrap and by whichever package ships the readings, both
 * after this module is first imported.
 */
export function parseSpacProcessForce(raw: boolean | string | undefined): SpacProcessForce {
  if (raw === undefined || raw === false) return { kind: "none" };
  if (raw === true) return { kind: "all" };
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "all") return { kind: "all" };
  const valid = listBackfillableExtractorIds();
  const validSet: ReadonlySet<string> = new Set(valid);
  const ids: ExtractorId[] = [];
  for (const token of raw.split(",")) {
    const id = token.trim();
    if (id === "") continue;
    if (!validSet.has(id)) {
      throw new Error(`Unknown extractor '${id}'. Valid ids: ${valid.join(", ")}`);
    }
    ids.push(id);
  }
  if (ids.length === 0) return { kind: "all" };
  return { kind: "extractors", ids };
}
