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
    // A bare board reference as the WHOLE title is just a directorship. Anchored
    // to the full title so it never rewrites the trailing "Board of Directors"
    // inside "Chairman of the Board of Directors".
    pattern: /^(?:the\s+)?board of directors$/i,
    replacement: "Director",
    note: "a bare 'Board of Directors' as the entire title is just 'Director'",
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
  {
    // A trailing "Chair*" with no board phrase — either the whole title
    // ("Chairman") or a compound ("... and Chairman") — is the board chair. Kept
    // conservative (whole-title or after "and") so a committee chair such as
    // "Chairman of the Audit Committee" is untouched, and idempotent because the
    // expansion no longer ends in "Chair*". Runs after the "Chair* of the Board"
    // rule so an already-boarded chair is handled there first.
    pattern: /(^|\band )chair(man|woman|person)?$/i,
    replacement: "$1Chair$2 of the Board of Directors",
    note: "a trailing bare 'Chair*' ('Chairman', '... and Chairman') -> '... of the Board of Directors'",
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
  const titleCased = title
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word, i) => titleCaseWord(word, i === 0))
    .join(" ");
  return canonicalizeNominee(titleCased);
}

/**
 * Canonicalize director/officer nominee phrasing — a person named in the
 * management section who is nominated or to be appointed but not yet seated.
 * Applied AFTER Title Case, which would otherwise lowercase a parenthesized
 * "(Nominee)" suffix (it title-cases on the leading "("). A plain board nominee
 * stays "Director Nominee"; a nominee to a specific board role (Chairman, Vice
 * Chairman, …) gets a parenthesized " (Nominee)" suffix — e.g. "Chairman of the
 * Board of Directors (Nominee)". Idempotent: an already-parenthesized suffix
 * (possibly re-lowercased by Title Case) is re-cased, not re-wrapped.
 */
function canonicalizeNominee(title: string): string {
  // Already parenthesized (Title Case may have lowered it to "(nominee)"): re-case.
  if (/\(nominee\)$/i.test(title)) return title.replace(/\(nominee\)$/i, "(Nominee)");
  // "<… of the Board of Directors> Nominee" -> "… (Nominee)". A bare "Director
  // Nominee" (no board phrase) is intentionally left unparenthesized.
  if (/ of the board of directors nominee$/i.test(title)) {
    return title.replace(/\s+Nominee$/i, " (Nominee)");
  }
  return title;
}

/**
 * Role separators for splitting a compound title into distinct roles. Matches a
 * comma, semicolon, ampersand, slash, or the word "and" (with surrounding
 * whitespace). A global split drops the empty piece left by an Oxford ", and",
 * so "President, CEO, and Director" yields three roles.
 *
 * Known limitation: a role that legitimately contains "and" ("Research and
 * Development") would be over-split — acceptable for management titles, which
 * are role labels, not descriptive phrases.
 */
const ROLE_SEPARATOR = /\s*(?:,|;|&|\/|\band\b)\s*/gi;

/**
 * Canonicalize a person's title(s) into a de-duplicated list of distinct roles.
 * A person who is "Chief Executive Officer and Director" holds two roles —
 * `["Chief Executive Officer", "Director"]` — so we split compound titles on
 * {@link ROLE_SEPARATOR} and run each piece through {@link normalizeManagementTitle}.
 * Accepts a raw string, an already-split list (each entry is re-split defensively),
 * or null/undefined. De-duplicates case-insensitively, preserving first-seen order.
 */
export function normalizeManagementTitles(
  raw: string | readonly string[] | null | undefined
): string[] {
  const parts = Array.isArray(raw) ? raw : raw == null ? [] : [raw as string];
  const roles: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const piece of part.split(ROLE_SEPARATOR)) {
      const role = normalizeManagementTitle(piece);
      const key = role.toLowerCase();
      if (role !== "" && !seen.has(key)) {
        seen.add(key);
        roles.push(role);
      }
    }
  }
  return dropRedundantDirector(roles);
}

/** A board-seat role — "... of the Board of Directors" (Chairman, Vice Chairman, …). */
const BOARD_SEAT_ROLE = /of the board of directors$/i;

/**
 * A board chair already sits on the board, so a bare "Director" listed alongside
 * a "... of the Board of Directors" role is redundant and is dropped — e.g.
 * ["Chairman of the Board of Directors", "Director"] -> ["Chairman of the Board
 * of Directors"]. A plain officer role does NOT imply board membership, so
 * ["Chief Executive Officer", "Director"] keeps both.
 */
function dropRedundantDirector(roles: readonly string[]): string[] {
  if (!roles.some((r) => BOARD_SEAT_ROLE.test(r))) return [...roles];
  return roles.filter((r) => r.toLowerCase() !== "director");
}
