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
 *
 * X is recorded exactly as filed. Y's legal form is never copied onto it: a
 * form the filer did not write is a name that was never filed, and on the
 * canonicalize-identity forms (LLC, LP, GP, Trust) it survives
 * `normalizeCompanyName`, so the same underwriter named plainly and named
 * through a division clause minted two canonical companies and two identity
 * links. The parent is already recorded — in `familyName` and in
 * `source_context.family_name` — so the observation's only job is to be the
 * name as filed.
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
        observationName: x,
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
        observationName: x,
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
