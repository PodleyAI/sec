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
import { S1_SECTIONS } from "../sec/forms/registration-statements/s1/DocumentSegmenter";
import {
  hasProfileIdentification,
  parseSpacProfile,
} from "../sec/forms/registration-statements/s1/parseSpacProfile";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../storage/filing/FilingSchema";
import { SpacUnitTermsRepo } from "../storage/offering/SpacUnitTermsRepo";
import { SpacRepo } from "../storage/spac/SpacRepo";
import { extractPrimaryDocFromSubmission } from "../task/bootstrap/feedTarball";
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../util/accessionDocPath";

export interface SpacProfileEvalOptions {
  readonly extractorId?: "S-1" | "424";
  readonly limit?: number;
  readonly cik?: number;
  readonly onProgress?: (done: number, total: number, message: string) => void;
  readonly signal?: AbortSignal;
}

export type SpacProfileBucket = "hit-agree" | "hit-disagree" | "miss" | "empty" | "skip";

export interface SpacProfileLineScore {
  readonly focus: readonly string[];
  readonly focus_location: readonly string[];
}

export interface SpacProfileCase {
  readonly extractor_id: string;
  readonly accession_number: string;
  readonly cik: number | null;
  readonly bucket: SpacProfileBucket;
  readonly cachePath: string | undefined;
  readonly parsed?: SpacProfileLineScore;
  readonly stored?: SpacProfileLineScore;
  readonly reason?: string;
}

export interface SpacProfileReport {
  readonly cases: readonly SpacProfileCase[];
  readonly counts: Record<SpacProfileBucket, number>;
}

export async function runSpacProfileEval(
  options: SpacProfileEvalOptions = {}
): Promise<SpacProfileReport> {
  if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
    throw new SecCliConfigurationError(
      "SEC_RAW_DATA_FOLDER is not set; spac-profile eval reads accessiondocs and does not fetch EDGAR"
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
  const storedByCik = await loadStored();
  const sliced = options.limit !== undefined ? unitRows.slice(0, options.limit) : unitRows;
  const cases: SpacProfileCase[] = [];
  for (let i = 0; i < sliced.length; i++) {
    if (options.signal?.aborted) break;
    const item = sliced[i]!;
    options.onProgress?.(i, sliced.length, item.accession_number);
    const stored = storedByCik.get(item.cik ?? -1) ?? { focus: [], focus_location: [] };
    cases.push(await scoreCase(root, item, stored));
  }
  options.onProgress?.(sliced.length, sliced.length, "done");
  const counts: Record<SpacProfileBucket, number> = {
    "hit-agree": 0,
    "hit-disagree": 0,
    miss: 0,
    empty: 0,
    skip: 0,
  };
  for (const c of cases) counts[c.bucket] += 1;
  return { cases, counts };
}

async function loadStored(): Promise<Map<number, SpacProfileLineScore>> {
  const spacs = await new SpacRepo().getAllSpacs();
  const out = new Map<number, SpacProfileLineScore>();
  for (const row of spacs) {
    out.set(row.cik, {
      focus: parseJsonArray(row.focus),
      focus_location: parseJsonArray(row.focus_location),
    });
  }
  return out;
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === "") return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

async function scoreCase(
  root: string,
  item: {
    readonly extractor_id: string;
    readonly accession_number: string;
    readonly cik: number | null;
  },
  stored: SpacProfileLineScore
): Promise<SpacProfileCase> {
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
  const text = byName.get(S1_SECTIONS.PROSPECTUS_SUMMARY) ?? "";
  if (text.trim() === "") {
    return { ...base, cik, bucket: "skip", cachePath, reason: "no section" };
  }
  const parsedRow = parseSpacProfile(text);
  if (parsedRow === null) {
    const miss = bucketWhenParserEmpty({ stored, sectionText: text });
    return { ...base, cik, bucket: miss.bucket, cachePath, reason: miss.reason };
  }
  const parsed: SpacProfileLineScore = {
    focus: parsedRow.focus,
    focus_location: parsedRow.focus_location,
  };
  return {
    ...base,
    cik,
    bucket: scoredEqual(parsed, stored) ? "hit-agree" : "hit-disagree",
    cachePath,
    parsed,
  };
}

export function bucketWhenParserEmpty(args: {
  readonly stored: SpacProfileLineScore;
  readonly sectionText: string;
}): { readonly bucket: "skip" | "empty" | "miss"; readonly reason: string | undefined } {
  if (args.stored.focus.length === 0 && args.stored.focus_location.length === 0) {
    return { bucket: "skip", reason: "all-null stored" };
  }
  if (!hasProfileIdentification(args.sectionText)) {
    return { bucket: "skip", reason: "no-identification" };
  }
  return { bucket: "miss", reason: undefined };
}

function tagKey(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function scoredEqual(a: SpacProfileLineScore, b: SpacProfileLineScore): boolean {
  const af = a.focus.map(tagKey).toSorted();
  const bf = b.focus.map(tagKey).toSorted();
  const al = a.focus_location.map(tagKey).toSorted();
  const bl = b.focus_location.map(tagKey).toSorted();
  if (af.length !== bf.length || al.length !== bl.length) return false;
  return af.every((k, i) => k === bf[i]) && al.every((k, i) => k === bl[i]);
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
