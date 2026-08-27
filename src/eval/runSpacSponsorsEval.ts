/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from "node:fs";
import { globalServiceRegistry } from "workglow";
import { SecCliConfigurationError } from "../config/EnvToDI";
import { SEC_RAW_DATA_FOLDER } from "../config/tokens";
import { parseEdgarHtml } from "../sec/html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "../sec/forms/registration-statements/s1/DocumentTreeSegmenter";
import { S1_SECTIONS } from "../sec/html/sectionVocabulary";
import {
  hasSponsorIdentification,
  parseSpacSponsors,
} from "../sec/forms/registration-statements/s1/parseSpacSponsors";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../storage/filing/FilingSchema";
import { SpacUnitTermsRepo } from "../storage/offering/SpacUnitTermsRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { extractPrimaryDocFromSubmission } from "../task/bootstrap/feedTarball";
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../util/accessionDocPath";

export interface SpacSponsorsEvalOptions {
  readonly extractorId?: "S-1" | "424";
  readonly limit?: number;
  readonly cik?: number;
  readonly onProgress?: (done: number, total: number, message: string) => void;
  readonly signal?: AbortSignal;
}

export type SpacSponsorsBucket = "hit-agree" | "hit-disagree" | "miss" | "empty" | "skip";

export interface SpacSponsorsLineScore {
  readonly legal_name: string;
}

export interface SpacSponsorsCase {
  readonly extractor_id: string;
  readonly accession_number: string;
  readonly cik: number | null;
  readonly bucket: SpacSponsorsBucket;
  readonly cachePath: string | undefined;
  readonly parsed?: readonly SpacSponsorsLineScore[];
  readonly stored?: readonly SpacSponsorsLineScore[];
  readonly reason?: string;
}

export interface SpacSponsorsReport {
  readonly cases: readonly SpacSponsorsCase[];
  readonly counts: Record<SpacSponsorsBucket, number>;
}

export async function runSpacSponsorsEval(
  options: SpacSponsorsEvalOptions = {}
): Promise<SpacSponsorsReport> {
  if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
    throw new SecCliConfigurationError(
      "SEC_RAW_DATA_FOLDER is not set; spac-sponsors eval reads accessiondocs and does not fetch EDGAR"
    );
  }
  const root = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
  const extractorId = options.extractorId;
  const cikFilter = options.cik;
  const unitRows = (await new SpacUnitTermsRepo().listAll()).filter((r) => {
    if (extractorId !== undefined && r.extractor_id !== extractorId) return false;
    if (cikFilter !== undefined && r.cik !== cikFilter) return false;
    return true;
  });
  const storedByKey = await loadStored();
  const sliced = options.limit !== undefined ? unitRows.slice(0, options.limit) : unitRows;
  const cases: SpacSponsorsCase[] = [];
  for (let i = 0; i < sliced.length; i++) {
    if (options.signal?.aborted) break;
    const item = sliced[i]!;
    options.onProgress?.(i, sliced.length, item.accession_number);
    const stored = storedByKey.get(`${item.extractor_id}\t${item.accession_number}`) ?? [];
    cases.push(await scoreCase(root, item, stored));
  }
  options.onProgress?.(sliced.length, sliced.length, "done");
  const counts: Record<SpacSponsorsBucket, number> = {
    "hit-agree": 0,
    "hit-disagree": 0,
    miss: 0,
    empty: 0,
    skip: 0,
  };
  for (const c of cases) counts[c.bucket] += 1;
  return { cases, counts };
}

async function loadStored(): Promise<Map<string, SpacSponsorsLineScore[]>> {
  const companies = (await new CompanyObservationRepo().listAll()).filter((c) =>
    /s1:spac-sponsor/.test(c.source_context ?? "")
  );
  const storedByKey = new Map<string, SpacSponsorsLineScore[]>();
  for (const c of companies) {
    const key = `${c.extractor_id}\t${c.accession_number}`;
    const arr = storedByKey.get(key) ?? [];
    arr.push({ legal_name: c.name ?? "" });
    storedByKey.set(key, arr);
  }
  return storedByKey;
}

function sponsorText(byName: Map<string, string>): string {
  return (
    byName.get(S1_SECTIONS.THE_SPONSOR) ??
    [...byName.entries()]
      .filter(([name]) => name !== S1_SECTIONS.RISK_FACTORS)
      .map(([, sectionText]) => sectionText)
      .join("\n\n")
  );
}

async function scoreCase(
  root: string,
  item: {
    readonly extractor_id: string;
    readonly accession_number: string;
    readonly cik: number | null;
  },
  stored: readonly SpacSponsorsLineScore[]
): Promise<SpacSponsorsCase> {
  const base = {
    extractor_id: item.extractor_id,
    accession_number: item.accession_number,
    cik: item.cik,
    stored,
  };
  const filing = await loadFiling(item.cik, item.accession_number);
  if (filing === undefined) {
    return { ...base, bucket: "skip" as const, cachePath: undefined, reason: "no filing row" };
  }
  const cik = item.cik ?? filing.cik;
  const primary = resolvePrimaryDocName(filing.primary_doc);
  if (primary === undefined) {
    return { ...base, cik, bucket: "skip", cachePath: undefined, reason: "no primary_doc" };
  }
  const cachePath = cachedAccessionDocPath(root, cik, item.accession_number, primary);
  if (cachePath === undefined || !existsSync(cachePath)) {
    return { ...base, cik, bucket: "skip", cachePath, reason: "no cache" };
  }
  let html: string;
  try {
    html = readCachedHtml(cachePath, primary);
  } catch {
    return { ...base, cik, bucket: "skip", cachePath, reason: "unreadable" };
  }
  if (html === "") {
    return { ...base, cik, bucket: "skip", cachePath, reason: "empty cache" };
  }
  const doc = parseEdgarHtml(html, cachePath);
  const segmented = new DocumentTreeSegmenter().segment(doc);
  const byName = new Map(segmented.map((s) => [s.name, s.text]));
  const text = sponsorText(byName);
  if (text.trim() === "") {
    return { ...base, cik, bucket: "skip", cachePath, reason: "no section" };
  }
  const parsedRows = parseSpacSponsors(text);
  const parsed: SpacSponsorsLineScore[] = parsedRows.map((r) => ({ legal_name: r.legal_name }));
  if (parsed.length === 0) {
    const miss = bucketWhenParserEmpty({ stored, sectionText: text });
    return { ...base, cik, bucket: miss.bucket, cachePath, parsed, reason: miss.reason };
  }
  return {
    ...base,
    cik,
    bucket: scoredEqual(parsed, stored) ? "hit-agree" : "hit-disagree",
    cachePath,
    parsed,
  };
}

export function bucketWhenParserEmpty(args: {
  readonly stored: readonly SpacSponsorsLineScore[];
  readonly sectionText: string;
}): { readonly bucket: "skip" | "empty" | "miss"; readonly reason: string | undefined } {
  if (args.stored.length === 0) {
    return { bucket: "skip", reason: "all-null stored" };
  }
  if (!hasSponsorIdentification(args.sectionText)) {
    return { bucket: "skip", reason: "no-identification" };
  }
  return { bucket: "miss", reason: undefined };
}

function nameKey(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function scoredEqual(
  a: readonly SpacSponsorsLineScore[],
  b: readonly SpacSponsorsLineScore[]
): boolean {
  const aKeys = a.map((r) => nameKey(r.legal_name)).toSorted();
  const bKeys = b.map((r) => nameKey(r.legal_name)).toSorted();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k, i) => k === bKeys[i]);
}

function readCachedHtml(cachePath: string, primary: string): string {
  const raw = readFileSync(cachePath, "utf8");
  if (/<SUBMISSION>|<SEC-HEADER>/i.test(raw)) {
    return extractPrimaryDocFromSubmission(raw, primary) ?? "";
  }
  return raw;
}

async function loadFiling(
  cik: number | null,
  accession_number: string
): Promise<Filing | undefined> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  if (cik !== null) {
    const row = await repo.get({ cik, accession_number });
    if (row) return row;
  }
  const rows = (await repo.query({ accession_number })) ?? [];
  return rows[0];
}
