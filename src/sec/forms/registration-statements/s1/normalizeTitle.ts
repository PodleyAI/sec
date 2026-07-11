/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deterministic, post-model canonicalization of management titles.
 *
 * Models agree on a person's *role* but phrase the title inconsistently —
 * "Chairman of our board of directors", "member of the Board of Directors",
 * "Chief Executive Officer and a director" — and even a single strong model is
 * not consistent call to call. Rather than hope the prompt pins every variant,
 * we run the model's `title` through a fixed list of known fixes so the stored
 * value is canonical regardless of which model produced it (the extraction
 * prompt still nudges toward this form, so the normalizer usually has little to
 * do; it is the guarantee, not the only line of defense).
 *
 * Add a new entry to {@link KNOWN_TITLE_FIXES} when the eval surfaces another
 * recurring phrasing. Every fix must be **idempotent** — re-running the whole
 * pipeline on already-canonical text must be a no-op — so patterns that expand a
 * phrase guard against re-expanding it (see the board-chair lookahead).
 */

/** One known title phrasing and its canonical replacement. */
export interface TitleFix {
  /** Applied with `String.prototype.replace`; use the `g`/`i` flags as needed. */
  readonly pattern: RegExp;
  /** Replacement string (may reference capture groups, e.g. `$1`). */
  readonly replacement: string;
  /** Why this fix exists — shown in tests / docs, never at runtime. */
  readonly note: string;
}

/**
 * The ordered list of known title fixes. Order matters: possessive board
 * references are rewritten to "the Board" **first**, so the later board-seat and
 * board-chair rules see a uniform "the Board of Directors" phrasing.
 */
export const KNOWN_TITLE_FIXES: readonly TitleFix[] = [
  {
    pattern: /\b(?:our|its|their|the company'?s|the registrant'?s)\s+board\b/gi,
    replacement: "the Board",
    note: "a possessive board reference ('our board', \"the Company's board\") -> 'the Board'",
  },
  {
    pattern: /^(?:a\s+|an\s+)?member of the board(?: of directors)?$/i,
    replacement: "Director",
    note: "a plain board seat ('Member of the Board of Directors') is just 'Director'",
  },
  {
    pattern: /\b(?:a|an|the)\s+(director|chairman|chairwoman|chairperson|chair)\b/gi,
    replacement: "$1",
    note: "drop an article before a role ('and a director' -> 'and Director')",
  },
  {
    // Expand a bare board chair to the canonical "... of the Board of Directors".
    // The negative lookahead keeps it idempotent (won't append twice).
    pattern: /\bchair(man|woman|person)? of the board(?! of directors)\b/gi,
    replacement: "Chair$1 of the Board of Directors",
    note: "'Chair* of the Board' -> canonical 'Chair* of the Board of Directors'",
  },
];

/**
 * Small connector words kept lowercase in Title Case unless they lead the title.
 */
const SMALL_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

/**
 * Common title acronyms re-uppercased after case folding, so "ceo"/"CEO" both
 * land on "CEO" rather than "Ceo".
 */
const ACRONYMS: ReadonlySet<string> = new Set([
  "ceo",
  "cfo",
  "coo",
  "cto",
  "cio",
  "cmo",
  "cro",
  "evp",
  "svp",
  "vp",
  "llc",
]);

/** Title-case one whitespace-delimited word, hyphen segments handled individually. */
function titleCaseWord(word: string, isFirst: boolean): string {
  if (word.length === 0) return word;
  const lower = word.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  if (!isFirst && SMALL_WORDS.has(lower)) return lower;
  return lower
    .split("-")
    .map((seg) => (seg.length === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1)))
    .join("-");
}

/**
 * Canonicalizes a management title: collapse whitespace, apply every known fix
 * in order, then Title Case the result. Idempotent — normalizing an already-
 * canonical title returns it unchanged. An empty/whitespace title returns "".
 */
export function normalizeManagementTitle(raw: string): string {
  let title = raw.replace(/\s+/g, " ").trim();
  if (title === "") return "";
  for (const fix of KNOWN_TITLE_FIXES) title = title.replace(fix.pattern, fix.replacement);
  return title
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word, i) => titleCaseWord(word, i === 0))
    .join(" ");
}
