/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EvalRawDump } from "./captureEvalRaw";

export function shouldDumpEvalRaw(args: {
  readonly ok: boolean;
  readonly raw: EvalRawDump | undefined;
  readonly diff:
    | {
        readonly missing: readonly unknown[];
        readonly extra: readonly unknown[];
        readonly mismatches: readonly unknown[];
      }
    | null
    | undefined;
}): boolean {
  if (args.raw === undefined) return false;
  if (!args.ok) return true;
  const d = args.diff;
  if (d == null) return false;
  return d.missing.length > 0 || d.extra.length > 0 || d.mismatches.length > 0;
}

export function formatEvalRawDump(raw: EvalRawDump): string {
  return JSON.stringify(raw, null, 2);
}

export function writeEvalRawDump(
  label: string,
  raw: EvalRawDump,
  write: (line: string) => void = (line) => console.error(line)
): void {
  write(`  --- raw (${raw.kind}) ${label} ---`);
  for (const line of formatEvalRawDump(raw).split("\n")) {
    write(`  ${line}`);
  }
}
