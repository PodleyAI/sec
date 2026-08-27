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
  hasBeneficialOwnershipTable,
  parseBeneficialOwnership,
} from "../sec/forms/registration-statements/s1/parseBeneficialOwnership";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../storage/filing/FilingSchema";
import { SpacUnitTermsRepo } from "../storage/offering/SpacUnitTermsRepo";
import { BeneficialOwnershipRepo } from "../storage/beneficial-ownership/BeneficialOwnershipRepo";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { extractPrimaryDocFromSubmission } from "../task/bootstrap/feedTarball";
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../util/accessionDocPath";

export interface BeneficialOwnershipEvalOptions {
  readonly extractorId?: "S-1" | "424";
  readonly limit?: number;
  readonly cik?: number;
  readonly onProgress?: (done: number, total: number, message: string) => void;
  readonly signal?: AbortSignal;
}

export type BeneficialOwnershipBucket = "hit-agree" | "hit-disagree" | "miss" | "empty" | "skip";

export interface BeneficialOwnershipLineScore {
  readonly name: string;
  readonly owner_kind: string;
  readonly shares_owned: number | null;
}

export interface BeneficialOwnershipCase {
  readonly extractor_id: string;
  readonly accession_number: string;
  readonly cik: number | null;
  readonly bucket: BeneficialOwnershipBucket;
  readonly cachePath: string | undefined;
  readonly parsed?: readonly BeneficialOwnershipLineScore[];
  readonly stored?: readonly BeneficialOwnershipLineScore[];
  readonly reason?: string;
}

export interface BeneficialOwnershipReport {
  readonly cases: readonly BeneficialOwnershipCase[];
  readonly counts: Record<BeneficialOwnershipBucket, number>;
}

export async function runBeneficialOwnershipEval(
  options: BeneficialOwnershipEvalOptions = {}
): Promise<BeneficialOwnershipReport> {
  if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
    throw new SecCliConfigurationError(
      "SEC_RAW_DATA_FOLDER is not set; beneficial-ownership eval reads accessiondocs and does not fetch EDGAR"
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
  const cases: BeneficialOwnershipCase[] = [];
  for (let i = 0; i < sliced.length; i++) {
    if (options.signal?.aborted) break;
    const item = sliced[i]!;
    options.onProgress?.(i, sliced.length, item.accession_number);
    const stored = storedByKey.get(`${item.extractor_id}\t${item.accession_number}`) ?? [];
    cases.push(await scoreCase(root, item, stored));
  }
  options.onProgress?.(sliced.length, sliced.length, "done");
  const counts: Record<BeneficialOwnershipBucket, number> = {
    "hit-agree": 0,
    "hit-disagree": 0,
    miss: 0,
    empty: 0,
    skip: 0,
  };
  for (const c of cases) counts[c.bucket] += 1;
  return { cases, counts };
}

async function loadStored(): Promise<Map<string, BeneficialOwnershipLineScore[]>> {
  const rows = await new BeneficialOwnershipRepo().listAll();
  const people = await new PersonObservationRepo().listAll();
  const companies = await new CompanyObservationRepo().listAll();
  const personById = new Map(people.map((p) => [p.observation_id, p]));
  const companyById = new Map(companies.map((c) => [c.observation_id, c]));
  const storedByKey = new Map<string, BeneficialOwnershipLineScore[]>();
  for (const r of rows) {
    const key = `${r.extractor_id}\t${r.accession_number}`;
    let name = "";
    if (r.owner_kind === "person" && r.observation_id !== null) {
      name = displayPerson(personById.get(r.observation_id));
    } else if (r.observation_id !== null) {
      name = companyById.get(r.observation_id)?.name ?? "";
    }
    const arr = storedByKey.get(key) ?? [];
    arr.push({ name, owner_kind: r.owner_kind, shares_owned: r.shares_owned });
    storedByKey.set(key, arr);
  }
  return storedByKey;
}

function displayPerson(
  person:
    | {
        first_name: string | null;
        middle_name: string | null;
        last_name: string | null;
        suffix: string | null;
      }
    | undefined
): string {
  if (person === undefined) return "";
  return [person.first_name, person.middle_name, person.last_name, person.suffix]
    .filter((p) => p != null && p !== "")
    .join(" ");
}

async function scoreCase(
  root: string,
  item: {
    readonly extractor_id: string;
    readonly accession_number: string;
    readonly cik: number | null;
  },
  stored: readonly BeneficialOwnershipLineScore[]
): Promise<BeneficialOwnershipCase> {
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
  const text = byName.get(S1_SECTIONS.BENEFICIAL_OWNERSHIP) ?? "";
  if (text.trim() === "") {
    return { ...base, cik, bucket: "skip", cachePath, reason: "no section" };
  }
  const parsedRows = parseBeneficialOwnership(text);
  const parsed: BeneficialOwnershipLineScore[] = parsedRows.map((r) => ({
    name: r.name,
    owner_kind: r.owner_kind,
    shares_owned: r.shares_owned,
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
  readonly stored: readonly BeneficialOwnershipLineScore[];
  readonly sectionText: string;
}): { readonly bucket: "skip" | "empty" | "miss"; readonly reason: string | undefined } {
  if (args.stored.length === 0) {
    return { bucket: "skip", reason: "all-null stored" };
  }
  if (!hasBeneficialOwnershipTable(args.sectionText)) {
    return { bucket: "skip", reason: "no-table" };
  }
  return { bucket: "miss", reason: undefined };
}

function nameKey(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function scoredEqual(
  a: readonly BeneficialOwnershipLineScore[],
  b: readonly BeneficialOwnershipLineScore[]
): boolean {
  const keyOf = (r: BeneficialOwnershipLineScore): string =>
    `${nameKey(r.name)}\t${r.owner_kind}\t${r.shares_owned ?? ""}`;
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
