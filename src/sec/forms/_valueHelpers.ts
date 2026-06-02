/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Small set of input-coercion helpers shared by every storage extractor
 * that reads optional string/number leaves out of a parsed XML tree.
 *
 * Treat empty strings, whitespace-only strings, and unparseable numerics
 * as `null` rather than fabricating `""` / `0`. The previous behaviour
 * (Value.Convert on `Type.Number()` for decimal-typed leaves) silently
 * coerced `"   "` and `""` to `0`, which then propagated into reports as
 * legitimate-looking zero dollars.
 *
 * Wrapped variants (`*Wrapped`) handle the `{ value: "..." }` shape that
 * the XML parser emits when an element has both attributes and a text
 * value — the scalar form is used directly on the unwrapped string.
 *
 * NOTE: This file is an inline copy of the helpers introduced by PR #118
 * (`src/sec/forms/insider-trading/_valueHelpers.ts`). When #118 merges
 * the duplicate should be removed in favour of a single shared module.
 */

export function strScalar(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function numScalar(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function strWrapped(v: { value?: unknown } | undefined | null): string | null {
  return strScalar(v?.value);
}

export function numWrapped(v: { value?: unknown } | undefined | null): number | null {
  return numScalar(v?.value);
}
