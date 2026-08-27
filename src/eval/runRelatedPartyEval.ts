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
  hasRelatedPartyTable,
  parseRelatedPartyTables,
} from "../sec/forms/registration-statements/s1/parseRelatedPartyTables";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../storage/filing/FilingSchema";
import { SpacUnitTermsRepo } from "../storage/offering/SpacUnitTermsRepo";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { RelatedPartyTransactionRepo } from "../storage/related-party/RelatedPartyTransactionRepo";
import { extractPrimaryDocFromSubmission } from "../task/bootstrap/feedTarball";
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../util/accessionDocPath";

export interface RelatedPartyEvalOptions {
  readonly extractorId?: "S-1" | "424";
  readonly limit?: number;
  readonly cik?: number;
  readonly onProgress?: (done: number, total: number, message: string) => void;
  readonly signal?: AbortSignal;
}

export type RelatedPartyBucket = "hit-agree" | "hit-disagree" | "miss" | "empty" | "skip";

export interface RelatedPartyLineScore {
  readonly name: string;
  readonly party_kind: string;
}

export interface RelatedPartyCase {
  readonly extractor_id: string;
  readonly accession_number: string;
  readonly cik: number | null;
  readonly bucket: RelatedPartyBucket;
  readonly cachePath: string | undefined;
  readonly parsed?: readonly RelatedPartyLineScore[];
  readonly stored?: readonly RelatedPartyLineScore[];
  readonly reason?: string;
}

export interface RelatedPartyReport {
  readonly cases: readonly RelatedPartyCase[];
  readonly counts: Record<RelatedPartyBucket, number>;
}

export async function runRelatedPartyEval(
  options: RelatedPartyEvalOptions = {}
): Promise<RelatedPartyReport> {
  if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
    throw new SecCliConfigurationError(
      "SEC_RAW_DATA_FOLDER is not set; related-party eval reads accessiondocs and does not fetch EDGAR"
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
  const cases: RelatedPartyCase[] = [];
  for (let i = 0; i < sliced.length; i++) {
    if (options.signal?.aborted) break;
    const item = sliced[i]!;
    options.onProgress?.(i, sliced.length, item.accession_number);
    const stored = storedByKey.get(`${item.extractor_id}\t${item.accession_number}`) ?? [];
    cases.push(await scoreCase(root, item, stored));
  }
  options.onProgress?.(sliced.length, sliced.length, "done");
  const counts: Record<RelatedPartyBucket, number> = {
    "hit-agree": 0,
    "hit-disagree": 0,
    miss: 0,
    empty: 0,
    skip: 0,
  };
  for (const c of cases) counts[c.bucket] += 1;
  return { cases, counts };
}

async function loadStored(): Promise<Map<string, RelatedPartyLineScore[]>> {
  const people = (await new PersonObservationRepo().listAll()).filter(
    (p) => p.relationship === "s1:related-party"
  );
  const companies = (await new CompanyObservationRepo().listAll()).filter((c) =>
    /s1:related-party/.test(c.source_context ?? "")
  );
  const storedByKey = new Map<string, RelatedPartyLineScore[]>();
  const add = (
    extractor_id: string,
    accession_number: string,
    name: string,
    party_kind: string
  ): void => {
    const key = `${extractor_id}\t${accession_number}`;
    const arr = storedByKey.get(key) ?? [];
    arr.push({ name, party_kind });
    storedByKey.set(key, arr);
  };
  for (const p of people) {
    add(
      p.extractor_id,
      p.accession_number,
      [p.first_name, p.middle_name, p.last_name, p.suffix]
        .filter((x) => x != null && x !== "")
        .join(" "),
      "person"
    );
  }
  for (const c of companies) {
    add(c.extractor_id, c.accession_number, c.name ?? "", "company");
  }
  const txs = await new RelatedPartyTransactionRepo().listAll();
  for (const t of txs) {
    if (t.party_kind !== "group" || t.party_label == null || t.party_label === "") continue;
    add(t.extractor_id, t.accession_number, t.party_label, "group");
  }
  return storedByKey;
}

async function scoreCase(
  root: string,
  item: {
    readonly extractor_id: string;
    readonly accession_number: string;
    readonly cik: number | null;
  },
  stored: readonly RelatedPartyLineScore[]
): Promise<RelatedPartyCase> {
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
  const text = byName.get(S1_SECTIONS.RELATED_PARTY) ?? "";
  if (text.trim() === "") {
    return { ...base, cik, bucket: "skip", cachePath, reason: "no section" };
  }
  const parsedRows = parseRelatedPartyTables(text);
  const parsed: RelatedPartyLineScore[] = parsedRows.map((r) => ({
    name: r.name,
    party_kind: r.party_kind,
  }));
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
  readonly stored: readonly RelatedPartyLineScore[];
  readonly sectionText: string;
}): { readonly bucket: "skip" | "empty" | "miss"; readonly reason: string | undefined } {
  if (args.stored.length === 0) {
    return { bucket: "skip", reason: "all-null stored" };
  }
  if (!hasRelatedPartyTable(args.sectionText)) {
    return { bucket: "skip", reason: "no-table" };
  }
  return { bucket: "miss", reason: undefined };
}

function nameKey(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function scoredEqual(
  a: readonly RelatedPartyLineScore[],
  b: readonly RelatedPartyLineScore[]
): boolean {
  const keyOf = (r: RelatedPartyLineScore): string => `${nameKey(r.name)}\t${r.party_kind}`;
  const aKeys = a.map(keyOf).toSorted();
  const bKeys = b.map(keyOf).toSorted();
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
