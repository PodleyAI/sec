/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EXTRACTOR_IDS, type ExtractorId } from "../../storage/versioning/extractorIds";

export type SpacProcessForce =
  | { readonly kind: "none" }
  | { readonly kind: "all" }
  | { readonly kind: "extractors"; readonly ids: readonly ExtractorId[] };

const ID_SET: ReadonlySet<string> = new Set(EXTRACTOR_IDS);

/**
 * Parse Commander `--force [extractors]`: omitted/false → none, bare true /
 * empty / `all` → all extractors, otherwise a comma-separated extractor-id list.
 */
export function parseSpacProcessForce(raw: boolean | string | undefined): SpacProcessForce {
  if (raw === undefined || raw === false) return { kind: "none" };
  if (raw === true) return { kind: "all" };
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "all") return { kind: "all" };
  const ids: ExtractorId[] = [];
  for (const token of raw.split(",")) {
    const id = token.trim();
    if (id === "") continue;
    if (!ID_SET.has(id)) {
      throw new Error(`Unknown extractor '${id}'. Valid ids: ${EXTRACTOR_IDS.join(", ")}`);
    }
    ids.push(id as ExtractorId);
  }
  if (ids.length === 0) return { kind: "all" };
  return { kind: "extractors", ids };
}
