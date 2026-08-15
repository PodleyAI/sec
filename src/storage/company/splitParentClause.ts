/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Split an as-filed underwriter/sponsor legal name that names a parent house
 * via a division or subsidiary clause. Observation name is X; family name is Y.
 *
 * Not an identity key and not {@link companyFamilyName}: that function is a
 * lossy transform of one name, and cannot jump to a parent named in a clause.
 */

export interface ParentClauseSplit {
  readonly observationName: string;
  readonly familyName: string;
  readonly asFiled: string;
  readonly split: boolean;
}

/** Optional article + optional wholly-owned + division|subsidiary + of. */
const CLAUSE = "(?:an?\\s+)?(?:wholly[\\s-]+owned\\s+)?(?:division|subsidiary)\\s+of";

const PAREN_CLAUSE = new RegExp(`\\(\\s*${CLAUSE}\\s+([^)]+?)\\s*\\)\\s*$`, "i");
const COMMA_CLAUSE = new RegExp(`^(.*?),\\s*${CLAUSE}\\s+(.+)$`, "i");

/**
 * Trailing legal-form tokens we are willing to copy from Y onto X.
 *
 * Ordered longest-first so `Limited Liability Company` wins over `Limited`,
 * `LLC` over `LP`, `Incorporated` over `Inc`. Deliberately excludes
 * Partners / Holdings / Group (`COMPANY_ENDINGS_NO_STRIP`) — those are
 * business-line words, not legal forms.
 */
const LEGAL_FORM_CANONICAL: ReadonlyArray<readonly [RegExp, string]> = [
  [/\blimited liability company\s*$/i, "LLC"],
  [/\blimited liability partnership\s*$/i, "LLP"],
  [/\bincorporated\s*$/i, "Inc"],
  [/\bcorporation\s*$/i, "Corp"],
  [/\bp\.?l\.?l\.?c\.?\s*$/i, "PLLC"],
  [/\bl\.?l\.?l\.?p\.?\s*$/i, "LLLP"],
  [/\bl\.?l\.?c\.?\s*$/i, "LLC"],
  [/\bl\.?l\.?p\.?\s*$/i, "LLP"],
  [/\binc\.?\s*$/i, "Inc"],
  [/\bcorp\.?\s*$/i, "Corp"],
  [/\bltd\.?\s*$/i, "Ltd"],
  [/\blimited\s*$/i, "Ltd"],
  [/\bplc\.?\s*$/i, "Plc"],
  [/\bpte\.?\s*$/i, "Pte"],
  [/\bl\.?p\.?\s*$/i, "LP"],
  [/\bcompany\s*$/i, "Co"],
  [/\bco\.?\s*$/i, "Co"],
];

function trailingLegalForm(name: string): string | undefined {
  const trimmed = name.trim();
  for (const [re, canonical] of LEGAL_FORM_CANONICAL) {
    if (re.test(trimmed)) return canonical;
  }
  return undefined;
}

function copyForm(x: string, y: string): string {
  if (trailingLegalForm(x) !== undefined) return x;
  const form = trailingLegalForm(y);
  if (form === undefined) return x;
  return `${x} ${form}`;
}

function intact(asFiled: string): ParentClauseSplit {
  return { observationName: asFiled, familyName: asFiled, asFiled, split: false };
}

export function splitParentClause(legalName: string): ParentClauseSplit {
  const asFiled = legalName.trim();
  if (asFiled === "") return intact("");

  const paren = asFiled.match(PAREN_CLAUSE);
  if (paren) {
    const x = asFiled.slice(0, paren.index).replace(/[,\s]+$/g, "").trim();
    const y = (paren[1] ?? "").trim();
    if (x !== "" && y !== "") {
      return {
        observationName: copyForm(x, y),
        familyName: y,
        asFiled,
        split: true,
      };
    }
  }

  const comma = asFiled.match(COMMA_CLAUSE);
  if (comma) {
    const x = (comma[1] ?? "").trim();
    const y = (comma[2] ?? "").trim();
    if (x !== "" && y !== "") {
      return {
        observationName: copyForm(x, y),
        familyName: y,
        asFiled,
        split: true,
      };
    }
  }

  return intact(asFiled);
}

export function parentClauseSourceContext(relation: string, split: ParentClauseSplit): string {
  if (!split.split) return JSON.stringify({ relation });
  return JSON.stringify({
    relation,
    as_filed: split.asFiled,
    family_name: split.familyName,
  });
}
