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
 * value. A wrapped call site may also receive a bare string when the same
 * extractor reads a mix of tagged and untagged leaves (e.g. the Ownership
 * Document, whose `documentType`/`issuerName` are bare while `securityTitle`
 * is wrapped), so `strWrapped` accepts both shapes.
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

export function strWrapped(v: { value?: unknown } | string | undefined | null): string | null {
  if (typeof v === "string") return strScalar(v);
  return strScalar(v?.value);
}

export function numWrapped(v: { value?: unknown } | string | undefined | null): number | null {
  // A bare string at a wrapped call site is a schema mismatch; refuse it
  // rather than guessing (matches the original insider-trading helper).
  if (typeof v === "string") return null;
  return numScalar(v?.value);
}
