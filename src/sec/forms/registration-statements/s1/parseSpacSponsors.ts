/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { hasCompanyEnding } from "../../../../storage/company/CompanyNormalization";
import { legalFormTrailingCanonical } from "../../../../util/legalForms";
import type { SpacSponsorRow } from "./spacSponsorSchema";

export function parseSpacSponsors(text: string): SpacSponsorRow[] {
  try {
    return findCandidates(text).filter(
      (r) => text.includes(r.source_span) || text.includes(r.legal_name)
    );
  } catch {
    return [];
  }
}

export function hasSponsorIdentification(text: string | undefined): boolean {
  if (text === undefined || text.trim() === "") return false;
  return findCandidates(text).length > 0;
}

const APPOSITIVE = /(?<!\bof\s)(?:our|the)\s+sponsor,\s+(.+?)\s*,\s+(?:is|was|a\s|an\s)/gi;
const COPULA =
  /(?<!\bof\s)(?:our|the)\s+sponsor\s+is\s+(?!a\s|an\s|majority|currently|the\s|not\s|permitted|controlled)(.{5,80}?(?:LLC|L\.L\.C\.|Ltd\.?|Limited|L\.P\.|LP|Inc\.|Corp\.|Corporation|GmbH|N\.V\.|B\.V\.))\b/gi;

function findCandidates(text: string): SpacSponsorRow[] {
  const out: SpacSponsorRow[] = [];
  const seen = new Set<string>();
  for (const re of [APPOSITIVE, COPULA]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      let legal_name = tidyName(m[1] ?? "");
      if (/(?:Ltd|Inc|Corp)$/i.test(legal_name) && text.includes(`${legal_name}.`)) {
        legal_name = `${legal_name}.`;
      }
      if (legal_name === "" || !looksLikeSponsorEntity(legal_name)) continue;
      const key = legal_name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const source_span = text.includes(m[0]!) ? m[0]! : legal_name;
      out.push({
        legal_name,
        confidence: 1,
        source_span,
        source: "deterministic",
      });
    }
  }
  return out;
}

function looksLikeCompanyName(name: string): boolean {
  return hasCompanyEnding(name) || legalFormTrailingCanonical.some(([re]) => re.test(name));
}

function looksLikeSponsorEntity(name: string): boolean {
  if (name.length > 80) return false;
  if (/^(controlled|owned|managed)\s+by\b/i.test(name)) return false;
  if (
    /officers?|directors?|affiliates?|investors?|nominees?|founders?|permitted|delaware limited/i.test(
      name
    )
  ) {
    return false;
  }
  if (name.split(/\s+/).length > 12) return false;
  return looksLikeCompanyName(name);
}

function tidyName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();
}
