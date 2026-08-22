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
import { offeringParseText } from "../sec/forms/registration-statements/s1/offeringSections";
import { looksLikeUnitIpo } from "../sec/forms/registration-statements/s1/parseOfferingTables";
import {
  hasSpacUseOfProceedsTable,
  parseSpacUseOfProceeds,
} from "../sec/forms/registration-statements/s1/parseSpacUseOfProceeds";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../storage/filing/FilingSchema";
import { SpacUnitTermsRepo } from "../storage/offering/SpacUnitTermsRepo";
import { UseOfProceedsRepo } from "../storage/use-of-proceeds/UseOfProceedsRepo";
import { extractPrimaryDocFromSubmission } from "../task/bootstrap/feedTarball";
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../util/accessionDocPath";

export interface UseOfProceedsEvalOptions {
  readonly extractorId?: "S-1" | "424";
  readonly limit?: number;
  readonly cik?: number;
  readonly onProgress?: (done: number, total: number, message: string) => void;
  readonly signal?: AbortSignal;
}

export type UseOfProceedsBucket = "hit-agree" | "hit-disagree" | "miss" | "empty" | "skip";

export interface UseOfProceedsLineScore {
  readonly purpose: string;
  readonly amount: number | null;
}

export interface UseOfProceedsCase {
  readonly extractor_id: string;
  readonly accession_number: string;
  readonly cik: number | null;
  readonly bucket: UseOfProceedsBucket;
  readonly cachePath: string | undefined;
  readonly parsed?: readonly UseOfProceedsLineScore[];
  readonly stored?: readonly UseOfProceedsLineScore[];
  readonly reason?: string;
}

export interface UseOfProceedsReport {
  readonly cases: readonly UseOfProceedsCase[];
  readonly counts: Record<UseOfProceedsBucket, number>;
}

export async function runUseOfProceedsEval(
  options: UseOfProceedsEvalOptions = {}
): Promise<UseOfProceedsReport> {
  if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
    throw new SecCliConfigurationError(
      "SEC_RAW_DATA_FOLDER is not set; use-of-proceeds eval reads accessiondocs and does not fetch EDGAR"
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
  const uopRepo = new UseOfProceedsRepo();
  const allUop = await uopRepo.listAll();
  const storedByKey = new Map<string, UseOfProceedsLineScore[]>();
  for (const r of allUop) {
    const key = `${r.extractor_id}\t${r.accession_number}`;
    const arr = storedByKey.get(key) ?? [];
    arr.push({ purpose: r.purpose ?? "", amount: r.amount });
    storedByKey.set(key, arr);
  }
  const sliced = options.limit !== undefined ? unitRows.slice(0, options.limit) : unitRows;
  const cases: UseOfProceedsCase[] = [];
  for (let i = 0; i < sliced.length; i++) {
    if (options.signal?.aborted) break;
    const item = sliced[i]!;
    options.onProgress?.(i, sliced.length, item.accession_number);
    const stored = storedByKey.get(`${item.extractor_id}\t${item.accession_number}`) ?? [];
    cases.push(await scoreCase(root, item, stored));
  }
  options.onProgress?.(sliced.length, sliced.length, "done");
  const counts: Record<UseOfProceedsBucket, number> = {
    "hit-agree": 0,
    "hit-disagree": 0,
    miss: 0,
    empty: 0,
    skip: 0,
  };
  for (const c of cases) counts[c.bucket] += 1;
  return { cases, counts };
}

async function scoreCase(
  root: string,
  item: {
    readonly extractor_id: string;
    readonly accession_number: string;
    readonly cik: number | null;
  },
  stored: readonly UseOfProceedsLineScore[]
): Promise<UseOfProceedsCase> {
  const base = {
    extractor_id: item.extractor_id,
    accession_number: item.accession_number,
    cik: item.cik,
    stored,
  };
  const filing = await loadFiling(item.cik, item.accession_number);
  if (filing === undefined) {
    return { ...base, bucket: "skip", cachePath: undefined, reason: "no filing row" };
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
    return { ...base, cik, bucket: "skip", cachePath, reason: "unreadable" };
  }
  const doc = parseEdgarHtml(html, cachePath);
  const segmented = new DocumentTreeSegmenter().segment(doc);
  const byName = new Map(segmented.map((s) => [s.name, s.text]));
  const text = byName.get(S1_SECTIONS.USE_OF_PROCEEDS) ?? "";
  if (text.trim() === "") {
    return { ...base, cik, bucket: "skip", cachePath, reason: "no section" };
  }
  const parsedRows = parseSpacUseOfProceeds(text);
  const parsed: UseOfProceedsLineScore[] = parsedRows.map((r) => ({
    purpose: r.purpose ?? "",
    amount: r.amount,
  }));
  if (parsed.length === 0) {
    const miss = bucketWhenParserEmpty({
      stored,
      offeringText: offeringParseText(byName),
      sectionText: text,
    });
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
  readonly stored: readonly UseOfProceedsLineScore[];
  readonly offeringText: string;
  readonly sectionText: string;
}): { readonly bucket: "skip" | "empty" | "miss"; readonly reason: string | undefined } {
  if (args.stored.length === 0) {
    return { bucket: "skip", reason: "all-null stored" };
  }
  if (!looksLikeUnitIpo(args.offeringText)) {
    return { bucket: "empty", reason: "resale" };
  }
  if (!hasSpacUseOfProceedsTable(args.sectionText)) {
    return { bucket: "skip", reason: "no-table" };
  }
  return { bucket: "miss", reason: undefined };
}

function purposeKey(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function scoredEqual(
  a: readonly UseOfProceedsLineScore[],
  b: readonly UseOfProceedsLineScore[]
): boolean {
  const aMap = new Map(a.map((r) => [purposeKey(r.purpose), r.amount]));
  const bMap = new Map(b.map((r) => [purposeKey(r.purpose), r.amount]));
  if (aMap.size !== bMap.size) return false;
  for (const [k, amount] of aMap) {
    if (!bMap.has(k)) return false;
    if (bMap.get(k) !== amount) return false;
  }
  return true;
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
