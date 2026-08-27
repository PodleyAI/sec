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
  offeringParseText,
  normalizeEntityName,
} from "../sec/forms/registration-statements/s1/offeringSections";
import { looksLikeUnitIpo } from "../sec/forms/registration-statements/s1/parseOfferingTables";
import {
  hasSpacSyndicateTable,
  parseSpacUnderwriters,
} from "../sec/forms/registration-statements/s1/parseSpacUnderwriters";
import { UnderwriterLinkRepo } from "../storage/canonical/UnderwriterLinkRepo";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../storage/filing/FilingSchema";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { SpacUnitTermsRepo } from "../storage/offering/SpacUnitTermsRepo";
import { extractPrimaryDocFromSubmission } from "../task/bootstrap/feedTarball";
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../util/accessionDocPath";

export interface UnderwritersEvalOptions {
  readonly extractorId?: "S-1" | "424";
  readonly limit?: number;
  readonly cik?: number;
  readonly onProgress?: (done: number, total: number, message: string) => void;
  readonly signal?: AbortSignal;
}

export type UnderwritersBucket = "hit-agree" | "hit-disagree" | "miss" | "empty" | "skip";

export interface UnderwritersCase {
  readonly extractor_id: string;
  readonly accession_number: string;
  readonly cik: number | null;
  readonly bucket: UnderwritersBucket;
  readonly cachePath: string | undefined;
  readonly parsed?: { readonly names: string[]; readonly roles: Array<string | null> };
  readonly stored?: { readonly names: string[]; readonly roles: Array<string | null> };
  readonly reason?: string;
}

export interface UnderwritersReport {
  readonly cases: readonly UnderwritersCase[];
  readonly counts: Record<UnderwritersBucket, number>;
}

interface ScoredNames {
  readonly names: string[];
  readonly roles: Array<string | null>;
}

export async function runUnderwritersEval(
  options: UnderwritersEvalOptions = {}
): Promise<UnderwritersReport> {
  if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
    throw new SecCliConfigurationError(
      "SEC_RAW_DATA_FOLDER is not set; underwriters eval reads accessiondocs and does not fetch EDGAR"
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
  const linkRepo = new UnderwriterLinkRepo();
  const obsRepo = new CompanyObservationRepo();
  const work = unitRows.map((r) => ({
    extractor_id: r.extractor_id,
    accession_number: r.accession_number,
    cik: r.cik,
  }));
  const sliced = options.limit !== undefined ? work.slice(0, options.limit) : work;
  const cases: UnderwritersCase[] = [];
  for (let i = 0; i < sliced.length; i++) {
    if (options.signal?.aborted) break;
    const item = sliced[i]!;
    options.onProgress?.(i, sliced.length, `${item.accession_number}`);
    const stored = await loadStored(linkRepo, obsRepo, item.extractor_id, item.accession_number);
    cases.push(await scoreCase(root, item, stored));
  }
  options.onProgress?.(sliced.length, sliced.length, "done");
  const counts: Record<UnderwritersBucket, number> = {
    "hit-agree": 0,
    "hit-disagree": 0,
    miss: 0,
    empty: 0,
    skip: 0,
  };
  for (const c of cases) counts[c.bucket] += 1;
  return { cases, counts };
}

async function loadStored(
  linkRepo: UnderwriterLinkRepo,
  obsRepo: CompanyObservationRepo,
  extractor_id: string,
  accession_number: string
): Promise<ScoredNames> {
  const links = (await linkRepo.listByAccession(accession_number)).filter(
    (r) => r.extractor_id === extractor_id
  );
  const obs = await obsRepo.listByAccessionAndExtractor(accession_number, extractor_id);
  const byIndex = new Map(obs.map((o) => [o.observation_index, o]));
  const names: string[] = [];
  const roles: Array<string | null> = [];
  for (const link of links) {
    const name = byIndex.get(link.observation_index)?.name?.trim() ?? "";
    if (name === "") continue;
    names.push(name);
    roles.push(link.role_detail);
  }
  return { names, roles };
}

async function scoreCase(
  root: string,
  item: {
    readonly extractor_id: string;
    readonly accession_number: string;
    readonly cik: number | null;
  },
  stored: ScoredNames
): Promise<UnderwritersCase> {
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
  const underwriting = byName.get(S1_SECTIONS.UNDERWRITING) ?? "";
  if (underwriting.trim() === "") {
    return { ...base, cik, bucket: "skip", cachePath, reason: "no section" };
  }
  const offeringText = offeringParseText(byName);
  const parsedRows = parseSpacUnderwriters(underwriting);
  const parsed: ScoredNames = {
    names: parsedRows.map((r) => r.legal_name),
    roles: parsedRows.map((r) => r.role),
  };
  if (parsed.names.length === 0) {
    const miss = bucketWhenParserEmpty({ stored, offeringText, underwritingText: underwriting });
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
  readonly stored: ScoredNames;
  readonly offeringText: string;
  readonly underwritingText: string;
}): { readonly bucket: "skip" | "empty" | "miss"; readonly reason: string | undefined } {
  if (args.stored.names.length === 0) {
    return { bucket: "skip", reason: "all-null stored" };
  }
  if (!looksLikeUnitIpo(args.offeringText)) {
    return { bucket: "empty", reason: "resale" };
  }
  if (!hasSpacSyndicateTable(args.underwritingText)) {
    return { bucket: "skip", reason: "no-table" };
  }
  return { bucket: "miss", reason: undefined };
}

function scoredEqual(a: ScoredNames, b: ScoredNames): boolean {
  const aMap = new Map<string, string | null>();
  for (let i = 0; i < a.names.length; i++) {
    aMap.set(normalizeEntityName(a.names[i]!), a.roles[i] ?? null);
  }
  const bMap = new Map<string, string | null>();
  for (let i = 0; i < b.names.length; i++) {
    bMap.set(normalizeEntityName(b.names[i]!), b.roles[i] ?? null);
  }
  if (aMap.size !== bMap.size) return false;
  for (const [k, role] of aMap) {
    if (!bMap.has(k)) return false;
    if (bMap.get(k) !== role) return false;
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
