/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { foldDiacritics, foldTypographicPunctuation } from "../../util/dataCleaningUtils";
import { legalFormFoldedTokens } from "../../util/legalForms";

/**
 * The *family* a company name belongs to — the sponsor or underwriter behind a
 * vehicle, rather than the vehicle itself. `WAVE Equity Fund II, L.P.` and
 * `WAVE Equity Fund, LLC` are two vehicles of one family, `wave-equity-fund`.
 *
 * Deliberately lossy, and NOT an identity key. `normalizeCompany` answers "are
 * these the same legal entity" and keeps the legal form and series numeral that
 * distinguish one fund from the next; this answers "are these the same house"
 * and throws exactly those away. Using it to de-duplicate entities would merge
 * every SPV a sponsor ever formed.
 *
 * Today the family tier keys off the legal name every observation already
 * carries, via {@link companyFamilyName}. That is what makes a family
 * rebuildable: a re-partition is a re-computation, not a re-extraction of a
 * model-emitted common name that never reached the observation row.
 */

/**
 * Business-line words are deliberately NOT stripped.
 *
 * An earlier draft dropped `Capital`, `Ventures`, `Partners`, `Group` and the
 * rest, which read as harmless boilerplate and is not: those words routinely
 * distinguish two real houses. `Acme Capital` and `Acme Ventures` can be
 * unrelated firms, and a rule that folds both to `acme` merges them with no
 * evidence that they belong together and no way to tell afterwards. A family
 * key that over-merges is worse than one that under-merges — an under-merge is
 * visible as two families and fixable with an alias, while an over-merge
 * silently attributes one house's deals to another.
 *
 * So this strips only what carries no identity in any name: the legal form, the
 * series marker that separates one vehicle from the next, and structural noise.
 * `Chardan Capital Markets` therefore stays `chardan-capital-markets` rather
 * than becoming `chardan`, and the two are joined by an explicit alias:
 *
 * ```sh
 * sec canonical underwriter-family alias "Chardan Capital Markets" "Chardan"
 * ```
 *
 * That is the right home for it: an alias is a stated, reviewable claim that
 * two names are one house, recorded once by someone who checked — which is what
 * these cases actually are. They are also rare, so the cost is small.
 */

/**
 * Vehicle and business-line words that describe what an entity *is* rather than
 * who runs it.
 *
 * This is a **floor, never a strip list** — the opposite polarity to the rule
 * these words once served. Nothing here is dropped: `Chardan Capital Markets`
 * keeps every token, for the reason set out above. The list exists only to
 * answer one question — "would the name that survives stripping still name a
 * house?" — and a single one of these words does not. `fund` as a family key is
 * a collision waiting to happen: every sponsor's "Fund II" would land in it.
 *
 * `Equity` is deliberately absent: it is a qualifier inside a house name
 * (`WAVE Equity`), not a vehicle type. `Global` is absent too — dropping it
 * would unify `Citigroup Global Markets Inc.` with `Citigroup` at the cost of
 * gutting the real company `Fundamental Global Inc.`, and corrupting a real name
 * is the worse error.
 */
const GENERIC_VEHICLE_WORDS = new Set([
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

/**
 * A **well-formed** roman numeral, rather than merely a word spelled out of
 * roman-numeral letters.
 *
 * {@link ROMAN} accepts any run of `ivxlcdm`, which is enough at the end of a
 * name — a name almost never ENDS in `civil`, and the position is the evidence.
 * Mid-name it is not: `civil`, `dim`, `mild`, `vivid` and `lid` all pass the
 * character test, and dropping one of those from the middle of a name deletes a
 * real word. This regex rejects every one of them, since none is a valid
 * numeral. (`mix` and `xi` ARE valid numerals and would still be dropped; a
 * house named with one of those mid-name is the residual risk, and it costs an
 * alias rather than silently attributing anything.)
 */
const STRICT_ROMAN = /^(?=[ivxlcdm])m*(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3})$/;

/** A bare number or year a sponsor uses to serialize vehicles: `3`, `22`, `2017`. */
const SERIES_NUMBER = /^\d{1,4}$/;

/**
 * Prefixes an ownership table uses to describe a bloc rather than name one
 * holder. They are not part of any company's name.
 */
const BLOC_PREFIX = /^entit(?:y|ies)\s+(?:affiliated\s+with|of)\s+/i;

/**
 * A legal form, or the conjunction one strands: `Goldman Sachs & Co. LLC` folds
 * to `goldman sachs and co llc`, and dropping `llc` then `co` leaves `and`
 * hanging off the end of the house name. Always dropped — a legal form carries
 * no identity in any name.
 */
function isLegalTail(token: string): boolean {
  return legalFormFoldedTokens.has(token) || token === "and";
}

/** A series marker separating one vehicle of a house from the next. */
function isSeriesTail(token: string): boolean {
  return ROMAN.test(token) || SERIES_NUMBER.test(token);
}

function isDroppableTail(token: string): boolean {
  return isLegalTail(token) || isSeriesTail(token);
}

/**
 * Whether dropping the series marker at `end - 1` would leave a name that is a
 * single generic vehicle word — `Fund II` → `fund`, `Ventures 2021` → `ventures`
 * — and so names no house at all.
 *
 * Those are the names where the numeral is the ONLY distinguishing token, and
 * dropping it merges every unrelated vehicle that shares the generic word. The
 * asymmetry decides it: keeping the numeral under-merges, which shows up as two
 * families and costs one alias, while dropping it over-merges, which silently
 * attributes one house's deals to another and leaves no trace.
 */
function wouldLeaveBareVehicleWord(tokens: readonly string[], end: number): boolean {
  return end === 2 && GENERIC_VEHICLE_WORDS.has(tokens[0]!);
}

/**
 * Drop series markers that sit INSIDE the name rather than at its end.
 *
 * Sponsors serialize a vehicle wherever the name reads best, and roughly as
 * often that is mid-name: `Southern Cross Acquisition I Sponsor Corp.`,
 * `Osprey Acquisition III, Sponsor LLC`, `CGC III Sponsor DirectorCo LLC`. A
 * tail-only strip leaves the numeral in the key, so consecutive vehicles of one
 * house land in different families — `southern-cross-acquisition-i-sponsor` and
 * `southern-cross-acquisition-ii-sponsor` are the same sponsor, and both names
 * are in the committed golden labels.
 *
 * Three conditions keep this from eating real words, and each is doing work:
 *
 * - **Roman numerals only** ({@link STRICT_ROMAN}), never a bare number. An
 *   interior number is usually part of the name — `Route 66 Ventures` would
 *   otherwise become `route-ventures` — while a TRAILING one is a vintage
 *   (`Curnes Fund 2001`) and keeps its existing treatment.
 * - **Never the first token.** A leading numeral is the house's own name
 *   (`V Capital`, `X Holdings`), not a serialization of it.
 * - **Never the last token.** The tail loop has already ruled on that position,
 *   including the {@link wouldLeaveBareVehicleWord} floor — so `Fund III` keeps
 *   its numeral here too rather than being stripped by the back door.
 *
 * Those last two also make the result safe by construction: an interior index
 * has a token on each side, so a name can never be emptied or reduced to one.
 */
function dropInteriorSeriesMarkers(kept: readonly string[]): string[] {
  if (kept.length < 3) return [...kept];
  return kept.filter((token, i) => i === 0 || i === kept.length - 1 || !STRICT_ROMAN.test(token));
}

/**
 * Family slug for a company name, or `""` when the name yields none.
 *
 * Trailing legal forms and series markers are dropped repeatedly, so
 * `Churchill Sponsor XIII LLC` loses `llc`, then `xiii`, and keeps
 * `churchill-sponsor`. Business-line words stay — joining `Chardan Capital Markets`
 * to `Chardan` is an alias's job, not a normalizer's.
 *
 * The legal form always goes; the series marker goes UNLESS dropping it would
 * leave a single generic vehicle word standing as the whole house name
 * ({@link wouldLeaveBareVehicleWord}). `Fund III` therefore keeps its numeral
 * rather than collapsing to `fund` alongside every other sponsor's third fund.
 *
 * A series marker is dropped wherever it sits, not only at the end —
 * `Southern Cross Acquisition I Sponsor Corp.` is the same house as its `II`
 * (see {@link dropInteriorSeriesMarkers}, which is stricter mid-name than the
 * tail rule because position there is no longer evidence).
 *
 * Stripping never empties the result: a name of nothing but droppable tokens
 * (`III LLC`) is kept whole rather than returning nothing and colliding with
 * every other such name.
 */
export function companyFamilyName(name: string | null | undefined): string {
  if (!name) return "";
  const folded = foldTypographicPunctuation(String(name))
    .replace(BLOC_PREFIX, "")
    // A parenthetical is a jurisdiction or disambiguator, never the house:
    // `Credit Suisse Securities (USA) LLC`, `B&R Technology Sponsor LLC (Cayman)`.
    .replace(/\([^)]*\)/g, " ")
    // An ampersand is part of a house name (`Cohen & Company`,
    // `Keefe, Bruyette & Woods`), so it is spelled out rather than dropped.
    .replace(/&/g, " and ")
    .replace(/[.,;:]/g, "");
  // Fold accents to their ASCII base BEFORE dropping non-ASCII, or the filter
  // below turns the letter into a word break (`Coöperatieve` → `co peratieve`,
  // whose `co` then reads as a legal form) or deletes it outright (`Łukasz` →
  // `ukasz`, a different name). NFD alone is not enough: `ø` and `ł` carry the
  // mark inside the glyph and have no combining form to strip.
  const base = foldDiacritics(folded)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (base === "") return "";

  const tokens = base.split(" ").filter((t) => t.length > 0);
  let end = tokens.length;
  while (end > 1) {
    const tail = tokens[end - 1]!;
    if (isLegalTail(tail)) {
      end--;
      continue;
    }
    if (isSeriesTail(tail) && !wouldLeaveBareVehicleWord(tokens, end)) {
      end--;
      continue;
    }
    break;
  }
  // Every token was droppable (`Fund III`): keep the whole thing rather than
  // inventing a family from the first word of a vehicle description.
  const kept = end > 1 || !isDroppableTail(tokens[0]) ? tokens.slice(0, end) : tokens;

  return dropInteriorSeriesMarkers(kept).join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * True when `shorter`'s family tokens are a proper prefix of `longer`'s.
 *
 * A model that extracts both "Cantor" and "Cantor Fitzgerald & Co." has named
 * one house twice: the stub is a brand echo, not a second firm. Equal-length
 * family keys (Inc vs Limited of the same house) are not prefixes — those stay
 * two legal entities sharing a family.
 */
export function isCompanyFamilyPrefix(shorter: string, longer: string): boolean {
  const a = companyFamilyName(shorter);
  const b = companyFamilyName(longer);
  if (a === "" || b === "") return false;
  const aTok = a.split("-");
  const bTok = b.split("-");
  if (aTok.length >= bTok.length) return false;
  for (let i = 0; i < aTok.length; i++) {
    if (aTok[i] !== bTok[i]) return false;
  }
  return true;
}

/** True when `name`'s family tokens are a proper prefix of another name in `among`. */
export function isCompanyFamilyPrefixEcho(name: string, among: readonly string[]): boolean {
  const n = name.trim();
  if (n === "") return false;
  return among.some((other) => {
    const o = other.trim();
    return o !== "" && o !== n && isCompanyFamilyPrefix(n, o);
  });
}
