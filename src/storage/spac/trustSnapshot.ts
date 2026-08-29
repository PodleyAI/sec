/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether an incoming company-facts snapshot should replace the one already
 * on the spac row. At an equal period-end a strictly later filed date wins, so
 * a 10-Q/A restatement applies while an identical re-read of the same filing
 * does not re-write the row. An older quarter never regresses.
 *
 * The ordering rule the `spac` row's own writer applies, and the one a
 * contributed {@link CurrentTrustRefresh} has to answer its dry run with, so
 * the two cannot disagree about which snapshot is newer.
 */
export function isNewerTrustSnapshot(
  incoming: { readonly asOf: string; readonly filed: string },
  existing: { readonly asOf: string | null; readonly filed: string | null }
): boolean {
  if (existing.asOf == null || existing.asOf === "") return true;
  if (incoming.asOf > existing.asOf) return true;
  if (incoming.asOf < existing.asOf) return false;
  return existing.filed == null || incoming.filed > existing.filed;
}
