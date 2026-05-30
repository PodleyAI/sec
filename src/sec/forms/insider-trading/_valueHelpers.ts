/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared null-on-empty value helpers for SEC insider-trading form extractors.
//
// EDGAR XML elements that are present-but-empty (e.g. <aggregateMarketValue/>
// or <transactionShares><value/></transactionShares>) parse to "". We must
// preserve those as null rather than fabricating a 0 via Number("") === 0,
// which would lie to downstream consumers about the filing's actual content.
//
// Form 144 fields are scalar (the value sits directly on the element), while
// Ownership Document fields are wrapped in a `{ value }` leaf so the schema
// can distinguish an empty value from a missing element. The two pairs
// intentionally have different signatures so they can't collapse together
// and silently accept the wrong shape at a call site.

export function strScalar(n: string | number | undefined | null): string | null {
  if (n === undefined || n === null) return null;
  const t = String(n).trim();
  return t === "" ? null : t;
}

export function numScalar(n: string | number | undefined | null): number | null {
  if (n === undefined || n === null) return null;
  const t = String(n).trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function strWrapped(
  w: { value?: string } | string | undefined | null
): string | null {
  if (w === undefined || w === null) return null;
  if (typeof w === "string") {
    const t = w.trim();
    return t === "" ? null : t;
  }
  const v = w.value;
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

export function numWrapped(
  w: { value?: string } | string | undefined | null
): number | null {
  if (w === undefined || w === null) return null;
  // A bare string at a wrapped call site is a schema mismatch; refuse it
  // rather than guessing.
  if (typeof w === "string") return null;
  const v = w.value;
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
