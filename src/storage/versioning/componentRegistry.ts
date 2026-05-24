/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ComponentKind } from "./ComponentVersionSchema";
import { EXTRACTOR_IDS } from "./extractorIds";
import { RESOLVER_IDS } from "../../resolver/resolverIds";

const REGISTERED: ReadonlyArray<{ kind: ComponentKind; id: string }> = [
  ...EXTRACTOR_IDS.map((id) => ({ kind: "extractor" as const, id })),
  ...RESOLVER_IDS.map((id) => ({ kind: "resolver" as const, id })),
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
