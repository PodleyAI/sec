/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ComponentKind, ComponentSlot } from "./ComponentVersionSchema";
import type { VersionRegistry } from "./VersionRegistry";

export interface ActiveSlot {
  readonly slot: Extract<ComponentSlot, "current" | "next">;
  readonly semver: string;
}

/**
 * Resolves which slot's extractor version should be used right now.
 *
 * "Next if exists, else current". When a dev cycle
 * is in flight (next-slot row exists), all processing targets that slot. When
 * no dev cycle is in flight, processing targets current.
 *
 * Returns undefined when the component has no current OR next slot — i.e. the
 * component isn't registered yet. Callers should treat this as an error.
 */
export async function getActiveSlot(
  reg: VersionRegistry,
  kind: ComponentKind,
  id: string
): Promise<ActiveSlot | undefined> {
  const next = await reg.getNext(kind, id);
  if (next) return { slot: "next", semver: next.semver };
  const current = await reg.getCurrent(kind, id);
  if (current) return { slot: "current", semver: current.semver };
  return undefined;
}
