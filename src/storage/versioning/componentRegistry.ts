/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ComponentKind } from "./ComponentVersionSchema";
import { EXTRACTOR_IDS } from "./extractorIds";

/**
 * The set of (kind, id) pairs that the CLI accepts. Mutating ceremonies
 * (start-dev / promote / rollback / drop-next) reject any (kind, id) not
 * listed here. PR3 registers only extractors; PR4 will add resolvers.
 */
const REGISTERED: ReadonlyArray<{ kind: ComponentKind; id: string }> = [
  ...EXTRACTOR_IDS.map((id) => ({ kind: "extractor" as const, id })),
];

export function isRegisteredComponent(kind: ComponentKind, id: string): boolean {
  return REGISTERED.some((r) => r.kind === kind && r.id === id);
}

export function listRegisteredComponents(): ReadonlyArray<{
  kind: ComponentKind;
  id: string;
}> {
  return REGISTERED;
}
