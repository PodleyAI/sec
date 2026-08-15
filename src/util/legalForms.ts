/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One legal-form vocabulary. Family-name stripping, identity
 * normalize/canonicalize, parent-clause copy, and 8-K counterparty extraction
 * all derive their matchers from {@link LEGAL_FORMS} — they do not keep their
 * own suffix lists.
 *
 * `identity` is the one place the consumers still differ on purpose:
 * `normalizeCompanyName` strips Inc/Corp/Ltd and rewrites dotted LLC/LP/GP to
 * a canonical abbreviation, but must not start stripping Plc/GmbH/Trust (that
 * would re-key every company observation). Family keys and prose extraction
 * still treat those as legal forms.
 */

export type LegalFormIdentity = "strip" | "canonicalize" | "keep";

export interface LegalFormSpec {
  readonly canonical: string;
  readonly spellings: readonly string[];
  readonly identity: LegalFormIdentity;
}

export const LEGAL_FORMS = [
  {
    canonical: "LLC",
    spellings: ["Limited Liability Company", "L.L.C.", "LLC"],
    identity: "canonicalize",
  },
  {
    canonical: "LLP",
    spellings: ["Limited Liability Partnership", "L.L.P.", "LLP"],
    identity: "canonicalize",
  },
  { canonical: "PLLC", spellings: ["P.L.L.C.", "PLLC"], identity: "canonicalize" },
  { canonical: "LLLP", spellings: ["L.L.L.P.", "LLLP"], identity: "keep" },
  { canonical: "SARL", spellings: ["S.A.R.L.", "SARL"], identity: "canonicalize" },
  { canonical: "Inc", spellings: ["Incorporated", "Inc."], identity: "strip" },
  { canonical: "Corp", spellings: ["Corporation", "Corp."], identity: "strip" },
  { canonical: "Ltd", spellings: ["Limited", "Ltd."], identity: "strip" },
  { canonical: "LP", spellings: ["L.P.", "LP"], identity: "canonicalize" },
  { canonical: "GP", spellings: ["G.P.", "GP"], identity: "canonicalize" },
  { canonical: "PC", spellings: ["P.C.", "PC"], identity: "canonicalize" },
  { canonical: "PA", spellings: ["P.A.", "PA"], identity: "canonicalize" },
  { canonical: "Plc", spellings: ["Plc"], identity: "keep" },
  { canonical: "Co", spellings: ["Company", "Co."], identity: "strip" },
  { canonical: "Pte", spellings: ["Pte."], identity: "strip" },
  { canonical: "Pty", spellings: ["Pty."], identity: "keep" },
  { canonical: "N.V.", spellings: ["N.V."], identity: "keep" },
  { canonical: "SA", spellings: ["S.A.", "SA"], identity: "keep" },
  { canonical: "BV", spellings: ["B.V.", "BV"], identity: "keep" },
  { canonical: "UA", spellings: ["U.A.", "UA"], identity: "keep" },
  { canonical: "SPC", spellings: ["SPC"], identity: "keep" },
  { canonical: "AG", spellings: ["AG"], identity: "keep" },
  { canonical: "GmbH", spellings: ["GmbH"], identity: "keep" },
  { canonical: "KG", spellings: ["KG"], identity: "keep" },
  { canonical: "AB", spellings: ["AB"], identity: "keep" },
  { canonical: "AS", spellings: ["AS"], identity: "keep" },
  { canonical: "OY", spellings: ["OY"], identity: "keep" },
  { canonical: "APS", spellings: ["APS"], identity: "keep" },
  { canonical: "Trust", spellings: ["Trust"], identity: "keep" },
] as const satisfies readonly LegalFormSpec[];

function caseInsensitiveLetters(pattern: string): string {
  return pattern.replace(/[A-Za-z]/g, (ch) => `[${ch.toUpperCase()}${ch.toLowerCase()}]`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Prose matcher for one spelling, case-folded only where filers really do vary.
 *
 * An ordinary English-word spelling (Corporation, Company, Limited,
 * Incorporated, Trust) keeps the filing's capitalisation, plus an ALL-CAPS
 * variant for filers who shout their exhibit prose. Lowercased, those words are
 * not part of a party name at all — they are the jurisdiction clause that
 * follows it ("a Delaware corporation", "a German company"), so folding them
 * made "Delaware corporation" itself the extracted counterparty. Short
 * abbreviations (Plc, Inc, Ltd, LLC, N.V.) stay fully case-folded: filers write
 * "Barclays plc" and "TARGET HOLDINGS, INC." alike.
 *
 * Each alternative is closed with `(?![A-Za-z])`, never `\b`: a trailing word
 * boundary would refuse the dot of "Corp." and silently truncate the name to
 * "Corp". The leading `\b` also stops a short form matching inside a longer
 * word ("Business Combination **Ag**reement" as the AG spelling).
 */
function spellingToProsePattern(spelling: string): string {
  const trimmed = spelling.trim();
  const body = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
  const letters = body.replace(/[^A-Za-z]/g, "");
  const core =
    letters.length > 3 && /[a-z]/.test(letters)
      ? `(?:${escapeRegex(body)}|${escapeRegex(body.toUpperCase())})`
      : caseInsensitiveLetters(escapeRegex(body));
  return `\\b${core}\\.?(?![A-Za-z])`;
}

function allSpellings(): readonly string[] {
  return LEGAL_FORMS.flatMap((form) => [...form.spellings]);
}

function buildProseAlternation(): string {
  const spellings = allSpellings().toSorted((a, b) => b.length - a.length || a.localeCompare(b));
  const seen = new Set<string>();
  const alts: string[] = [];
  for (const spelling of spellings) {
    const pattern = spellingToProsePattern(spelling);
    if (seen.has(pattern)) continue;
    seen.add(pattern);
    alts.push(pattern);
  }
  return alts.join("|");
}

function foldedToken(spelling: string): string | undefined {
  if (/\s/.test(spelling)) return undefined;
  const folded = spelling.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return folded === "" ? undefined : folded;
}

function buildFoldedTokens(): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const form of LEGAL_FORMS) {
    const canonicalFolded = foldedToken(form.canonical);
    if (canonicalFolded !== undefined) tokens.add(canonicalFolded);
    for (const spelling of form.spellings) {
      const folded = foldedToken(spelling);
      if (folded !== undefined) tokens.add(folded);
    }
  }
  return tokens;
}

function spellingToTrailingRe(spelling: string): RegExp {
  const inner = spelling.trim().replace(/\./g, "\\.?").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${inner}\\s*$`, "i");
}

function buildTrailing(): ReadonlyArray<readonly [RegExp, string]> {
  const entries: Array<{ spelling: string; canonical: string }> = [];
  for (const form of LEGAL_FORMS) {
    for (const spelling of form.spellings) {
      entries.push({ spelling, canonical: form.canonical });
    }
  }
  entries.sort(
    (a, b) => b.spelling.length - a.spelling.length || a.spelling.localeCompare(b.spelling)
  );
  return entries.map((entry) => [spellingToTrailingRe(entry.spelling), entry.canonical] as const);
}

function buildIdentityStrip(): readonly string[] {
  const out: string[] = [];
  for (const form of LEGAL_FORMS) {
    if (form.identity !== "strip") continue;
    for (const spelling of form.spellings) {
      out.push(spelling.replace(/\./g, "").toUpperCase());
    }
  }
  return out;
}

function lettersOf(canonical: string): string {
  return canonical.replace(/[^A-Za-z]/g, "");
}

function flexibleDotted(letters: string): string {
  return [...letters].map((ch) => `${ch}[\\., ]{0,2}`).join("");
}

function buildIdentityCanonical(): ReadonlyArray<readonly [string, string]> {
  const forms = LEGAL_FORMS.filter((form) => form.identity === "canonicalize").toSorted(
    (a, b) => lettersOf(b.canonical).length - lettersOf(a.canonical).length
  );
  const pairs: Array<readonly [string, string]> = [];
  for (const form of forms) {
    for (const spelling of form.spellings) {
      if (/\s/.test(spelling)) {
        pairs.push([escapeRegex(spelling), form.canonical]);
      }
    }
    pairs.push([flexibleDotted(lettersOf(form.canonical)), form.canonical]);
  }
  return pairs;
}

export const legalFormFoldedTokens: ReadonlySet<string> = buildFoldedTokens();
export const legalFormProseSuffixAlternation: string = buildProseAlternation();
export const legalFormTrailingCanonical: ReadonlyArray<readonly [RegExp, string]> =
  buildTrailing();
export const legalFormIdentityStrip: readonly string[] = buildIdentityStrip();
export const legalFormIdentityCanonical: ReadonlyArray<readonly [string, string]> =
  buildIdentityCanonical();
