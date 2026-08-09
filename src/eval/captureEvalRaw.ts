/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { StructuredOutputValidationError } from "workglow";

export type EvalRawDump =
  | { readonly kind: "rows"; readonly rows: readonly unknown[] }
  | {
      readonly kind: "validation";
      readonly attempts: ReadonlyArray<{
        readonly attempt: number;
        readonly errors: ReadonlyArray<{ readonly path: string; readonly message: string }>;
        readonly object: Record<string, unknown> | undefined;
      }>;
    }
  | { readonly kind: "none" };

export function captureEvalRawFromRows(
  dumpRaw: boolean,
  rows: readonly unknown[]
): EvalRawDump | undefined {
  if (!dumpRaw) return undefined;
  return { kind: "rows", rows };
}

export function captureEvalRawFromError(
  dumpRaw: boolean,
  err: unknown
): EvalRawDump | undefined {
  if (!dumpRaw) return undefined;
  if (err instanceof StructuredOutputValidationError) {
    return { kind: "validation", attempts: err.attempts };
  }
  return { kind: "none" };
}
