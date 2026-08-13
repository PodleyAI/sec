/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { foldTypographicPunctuation } from "../../util/dataCleaningUtils";

/**
 * The *family* a company name belongs to — the sponsor or underwriter behind a
 * vehicle, rather than the vehicle itself. `WAVE Equity Fund II, L.P.` and
 * `WAVE Equity Fund III, LLC` are two funds of one family, `wave-equity`.
 *
 * Deliberately lossy, and NOT an identity key. `normalizeCompany` answers "are
 * these the same legal entity" and keeps the legal form and series numeral that
 * distinguish one fund from the next; this answers "are these the same house"
 * and throws exactly those away. Using it to de-duplicate entities would merge
 * every SPV a sponsor ever formed.
 *
 * Today the family tier keys off a **common name the AI extractor emitted**,
 * which is why a family cannot be re-partitioned in batch: only the legal name
 * reaches the observation row. Deriving the key from the legal name is what
 * this exists for.
 */

/**
 * Legal forms, stripped wherever they trail. Written without punctuation
 * because the caller has already folded it — `L.P.` arrives as `lp`.
 */
const LEGAL_FORMS = new Set([
  "llc",
  "lllp",
  "llp",
  "lp",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "plc",
  "sa",
  "nv",
  "bv",
  "ua",
  "spc",
  "ag",
  "gmbh",
  "kg",
  "ab",
  "as",
  "oy",
  "pte",
  "pty",
  "trust",
]);

/**
 * Vehicle and business-line words that describe what an entity *is* rather than
 * who runs it. Stripped only from the END, and only token-exact — a prefix rule
 * would take `Fundamental Global Inc.` down to nothing on `Fund`.
 *
 * `Equity` is deliberately absent: it is a qualifier inside a house name
 * (`WAVE Equity`), not a vehicle type, and stripping it would take the target
 * of this function's own worked example down to `wave`.
 *
 * `Global` is also absent, and that is a KNOWN GAP rather than an oversight:
 * dropping it would unify `Citigroup Global Markets Inc.` with `Citigroup`, but
 * would also take the real company `Fundamental Global Inc.` to `Fundamental`.
 * Corrupting a real name is the worse error, so the miss is accepted until
 * there is a corpus big enough to tell the two shapes apart.
 */
const VEHICLE_WORDS = new Set([
  "fund",
  "funds",
  "capital",
  "partners",
  "partnership",
  "holding",
  "holdings",
  "group",
  "securities",
  "markets",
  "market",
  "sponsor",
  "sponsors",
  "venture",
  "ventures",
  "management",
  "advisors",
  "advisers",
  "associates",
  "investment",
  "investments",
  "invest",
  "acquisition",
  "acquisitions",
  "portfolio",
  "master",
]);

/** A roman numeral (series marker): `II`, `XIII`, `VG VI`'s `VI`. */
const ROMAN = /^[ivxlcdm]+$/;

/** A bare number or year a sponsor uses to serialize vehicles: `3`, `22`, `2017`. */
const SERIES_NUMBER = /^\d{1,4}$/;

/**
 * Prefixes an ownership table uses to describe a bloc rather than name one
 * holder. They are not part of any company's name.
 */
const BLOC_PREFIX = /^entit(?:y|ies)\s+(?:affiliated\s+with|of)\s+/i;

function isDroppableTail(token: string): boolean {
  return (
    LEGAL_FORMS.has(token) ||
    VEHICLE_WORDS.has(token) ||
    ROMAN.test(token) ||
    SERIES_NUMBER.test(token) ||
    // A conjunction stranded by the token it joined: `Goldman Sachs & Co. LLC`
    // becomes `goldman sachs and co llc`, and dropping `llc` then `co` leaves
    // `and` hanging off the end of the house name.
    token === "and"
  );
}

/**
 * Family slug for a company name, or `""` when the name yields none.
 *
 * Trailing legal forms, vehicle words and series markers are dropped
 * repeatedly, so `Churchill Sponsor XIII LLC` loses `llc`, then `xiii`, then
 * `sponsor`. Stripping never empties the result: `Fund III` is nothing BUT
 * droppable tokens, and a name that says only "the third fund" identifies no
 * house, so the last non-empty state is kept rather than returning nothing.
 */
export function companyFamilyName(name: string | null | undefined): string {
  if (!name) return "";
  const base = foldTypographicPunctuation(String(name))
    .replace(BLOC_PREFIX, "")
    // A parenthetical is a jurisdiction or disambiguator, never the house:
    // `Credit Suisse Securities (USA) LLC`, `B&R Technology Sponsor LLC (Cayman)`.
    .replace(/\([^)]*\)/g, " ")
    // An ampersand is part of a house name (`Cohen & Company`,
    // `Keefe, Bruyette & Woods`), so it is spelled out rather than dropped.
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[.,;:]/g, "")
    // Fold diacritics to their base letter BEFORE dropping non-ASCII, or the
    // mark itself becomes a word break: `Coöperatieve` split into
    // `co peratieve` and read as the legal form `co` plus a stray token.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (base === "") return "";

  const tokens = base.split(" ").filter((t) => t.length > 0);
  let end = tokens.length;
  while (end > 1 && isDroppableTail(tokens[end - 1])) end--;
  // Every token was droppable (`Fund III`): keep the whole thing rather than
  // inventing a family from the first word of a vehicle description.
  const kept = end > 1 || !isDroppableTail(tokens[0]) ? tokens.slice(0, end) : tokens;

  return kept.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
