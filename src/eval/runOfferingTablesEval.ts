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
import {
  offeringParseText,
  promoteParseText,
} from "../sec/forms/registration-statements/s1/offeringSections";
import {
  looksLikeUnitIpo,
  parseSpacOfferingTerms,
  parseSpacPromoteTerms,
} from "../sec/forms/registration-statements/s1/parseOfferingTables";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../storage/filing/FilingSchema";
import { SpacPromoteTermsRepo } from "../storage/offering/SpacPromoteTermsRepo";
import { SpacUnitTermsRepo } from "../storage/offering/SpacUnitTermsRepo";
import { extractPrimaryDocFromSubmission } from "../task/bootstrap/feedTarball";
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../util/accessionDocPath";

export interface OfferingTablesEvalOptions {
  readonly extractorId?: "S-1" | "424";
  readonly limit?: number;
  readonly cik?: number;
  readonly onProgress?: (done: number, total: number, message: string) => void;
  readonly signal?: AbortSignal;
}

export type OfferingTablesBucket = "hit-agree" | "hit-disagree" | "miss" | "empty" | "skip";

export interface OfferingTablesCase {
  readonly kind: "offering" | "promote";
  readonly extractor_id: string;
  readonly accession_number: string;
  readonly cik: number | null;
  readonly bucket: OfferingTablesBucket;
  readonly cachePath: string | undefined;
  readonly parsed?: Record<string, unknown>;
  readonly stored?: Record<string, unknown>;
  readonly reason?: string;
}

export interface OfferingTablesReport {
  readonly cases: readonly OfferingTablesCase[];
  readonly counts: Record<OfferingTablesBucket, number>;
}

const OFFERING_FIELDS = [
  "price_per_unit",
  "warrant_fraction_per_unit",
  "right_fraction_per_unit",
  "trust_per_unit",
] as const;

const PROMOTE_FIELDS = [
  "founder_shares",
  "founder_percent",
  "private_placement_warrants",
  "public_warrant_coverage",
  "trust_per_public_share",
] as const;

export async function runOfferingTablesEval(
  options: OfferingTablesEvalOptions = {}
): Promise<OfferingTablesReport> {
  if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
    throw new SecCliConfigurationError(
      "SEC_RAW_DATA_FOLDER is not set; offering-tables eval reads accessiondocs and does not fetch EDGAR"
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
  const promoteRows = (await new SpacPromoteTermsRepo().listAll()).filter((r) => {
    if (extractorId !== undefined && r.extractor_id !== extractorId) return false;
    if (cikFilter !== undefined && r.cik !== cikFilter) return false;
    return true;
  });
  const work: Array<{
    readonly kind: "offering" | "promote";
    readonly extractor_id: string;
    readonly accession_number: string;
    readonly cik: number | null;
    readonly stored: Record<string, unknown>;
  }> = [
    ...unitRows.map((r) => ({
      kind: "offering" as const,
      extractor_id: r.extractor_id,
      accession_number: r.accession_number,
      cik: r.cik,
      stored: pick(r as unknown as Record<string, unknown>, OFFERING_FIELDS),
    })),
    ...promoteRows.map((r) => ({
      kind: "promote" as const,
      extractor_id: r.extractor_id,
      accession_number: r.accession_number,
      cik: r.cik,
      stored: pick(r as unknown as Record<string, unknown>, PROMOTE_FIELDS),
    })),
  ];
  const sliced = options.limit !== undefined ? work.slice(0, options.limit) : work;
  const cases: OfferingTablesCase[] = [];
  for (let i = 0; i < sliced.length; i++) {
    if (options.signal?.aborted) break;
    const item = sliced[i]!;
    options.onProgress?.(i, sliced.length, `${item.kind} ${item.accession_number}`);
    cases.push(await scoreCase(root, item));
  }
  options.onProgress?.(sliced.length, sliced.length, "done");
  const counts: Record<OfferingTablesBucket, number> = {
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
    readonly kind: "offering" | "promote";
    readonly extractor_id: string;
    readonly accession_number: string;
    readonly cik: number | null;
    readonly stored: Record<string, unknown>;
  }
): Promise<OfferingTablesCase> {
  const base = {
    kind: item.kind,
    extractor_id: item.extractor_id,
    accession_number: item.accession_number,
    cik: item.cik,
    stored: item.stored,
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
  if (item.kind === "offering") {
    const text = offeringParseText(byName);
    if (text.trim() === "") {
      return { ...base, cik, bucket: "skip", cachePath, reason: "no section" };
    }
    const parsed = parseSpacOfferingTerms(text);
    const scored =
      parsed === null ? null : pick(parsed as unknown as Record<string, unknown>, OFFERING_FIELDS);
    if (scored === null) {
      const miss = bucketWhenParserNull({ kind: "offering", stored: item.stored, text });
      return {
        ...base,
        cik,
        bucket: miss.bucket,
        cachePath,
        parsed: undefined,
        reason: miss.reason,
      };
    }
    return {
      ...base,
      cik,
      bucket: scoredEqual(scored, item.stored) ? "hit-agree" : "hit-disagree",
      cachePath,
      parsed: scored,
    };
  }
  const text = promoteParseText(byName);
  if (text.trim() === "") {
    return { ...base, cik, bucket: "skip", cachePath, reason: "no section" };
  }
  const parsed = parseSpacPromoteTerms(text);
  const scored =
    parsed === null ? null : pick(parsed as unknown as Record<string, unknown>, PROMOTE_FIELDS);
  if (scored === null) {
    const miss = bucketWhenParserNull({ kind: "promote", stored: item.stored, text });
    return { ...base, cik, bucket: miss.bucket, cachePath, parsed: undefined, reason: miss.reason };
  }
  return {
    ...base,
    cik,
    bucket: scoredEqual(scored, item.stored) ? "hit-agree" : "hit-disagree",
    cachePath,
    parsed: scored,
  };
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

function pick(row: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = round2(row[f]);
  return out;
}

function round2(v: unknown): unknown {
  if (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v)) {
    return Math.round(v * 100) / 100;
  }
  return v ?? null;
}

export function bucketWhenParserNull(args: {
  readonly kind: "offering" | "promote";
  readonly stored: Record<string, unknown>;
  readonly text: string;
}): { readonly bucket: "skip" | "empty" | "miss"; readonly reason: string | undefined } {
  if (isAllNull(args.stored)) {
    return { bucket: "skip", reason: "all-null stored" };
  }
  if (!looksLikeUnitIpo(args.text)) {
    return { bucket: "empty", reason: args.kind === "promote" ? "resale" : "not-unit-ipo" };
  }
  return { bucket: "miss", reason: undefined };
}

function isAllNull(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => v == null);
}

function scoredEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
