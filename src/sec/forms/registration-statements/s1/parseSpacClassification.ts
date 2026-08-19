/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SpacClassificationRow } from "./spacClassifierSchema";

const VEHICLE =
  /\b(?:is|are)\s+a\s+(?:newly\s+(?:organized|formed)\s+)?(?:blank[\s-]*check|special[\s-]+purpose[\s-]+acquisition)\s+company\b/i;
const PURPOSE =
  /\bformed for the purpose of (?:effecting|entering into|consummating|completing)\b/i;

export function parseSpacClassification(text: string): SpacClassificationRow | null {
  try {
    return findClassification(text);
  } catch {
    return null;
  }
}

export function hasSpacFormationIdentification(text: string | undefined): boolean {
  if (text === undefined || text.trim() === "") return false;
  return findClassification(text) !== null;
}

function findClassification(text: string): SpacClassificationRow | null {
  const vehicle = VEHICLE.exec(text);
  const purpose = PURPOSE.exec(text);
  if (vehicle === null || purpose === null) return null;
  const source_span = text.includes(vehicle[0]!) ? vehicle[0]! : purpose[0]!;
  if (!text.includes(source_span)) return null;
  return {
    is_spac: true,
    entity_kind: "spac",
    confidence: 1,
    source_span,
    source: "deterministic",
  };
}
