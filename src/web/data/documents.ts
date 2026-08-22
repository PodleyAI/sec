/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile, stat } from "node:fs/promises";
import { globalServiceRegistry, renderMarkdown } from "workglow";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { S1_SECTIONS } from "../../sec/forms/registration-statements/s1/DocumentSegmenter";
import { DocumentTreeSegmenter } from "../../sec/forms/registration-statements/s1/DocumentTreeSegmenter";
import { parseEdgarHtml } from "../../sec/html/parseEdgarHtml";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../../storage/filing/FilingSchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../../util/accessionDocPath";
import {
  fullSubmissionFileName,
  isFullSubmissionForm,
  isSpacNarrativeTrigger8K,
} from "../../task/forms/ProcessAccessionDocFormTask";

/** One segmented section: what an AI extractor is actually handed. */
export interface DocumentSection {
  readonly name: string;
  readonly chars: number;
  readonly text: string;
}

/**
 * A filing's body as the pipeline sees it, at each stage of the conversion the
 * AI extractors depend on: the bytes on disk, the converter's markdown, and the
 * segmenter's per-section prose.
 *
 * Every stage is optional and independently reported, because they fail
 * independently and an operator verifying an extraction needs to know WHICH one
 * came up empty: no cached file at all, a file the converter produced no
 * structure from, and a document the segmenter found no target sections in are
 * three different problems with three different fixes.
 */
export interface FilingDocument {
  readonly cik: number;
  readonly accessionNumber: string;
  readonly form: string;
  readonly filingDate: string | null;
  /** The document filename the pipeline reads — primary doc, or the full submission. */
  readonly fileName: string | undefined;
  /** Absolute path in the accession-doc cache, or undefined when it cannot be composed. */
  readonly path: string | undefined;
  /** True when `path` exists on disk. `sec spac download` fills it. */
  readonly cached: boolean;
  readonly bytes: number;
  /** Why the body is unavailable, or "" when it loaded. */
  readonly error: string;
  readonly raw: string;
  readonly markdown: string;
  readonly sections: readonly DocumentSection[];
  /** EDGAR's own page for the filing, so a reader can check the conversion against the source. */
  readonly edgarUrl: string;
}

/** The S-1 segmenter targets, in the order the prospectus presents them. */
export const SEGMENTER_SECTION_NAMES: readonly string[] = [
  S1_SECTIONS.PROSPECTUS_SUMMARY,
  S1_SECTIONS.RISK_FACTORS,
  S1_SECTIONS.THE_OFFERING,
  S1_SECTIONS.USE_OF_PROCEEDS,
  S1_SECTIONS.MANAGEMENT,
  S1_SECTIONS.EXECUTIVE_COMPENSATION,
  S1_SECTIONS.BENEFICIAL_OWNERSHIP,
  S1_SECTIONS.RELATED_PARTY,
  S1_SECTIONS.THE_SPONSOR,
  S1_SECTIONS.UNDERWRITING,
  S1_SECTIONS.THE_MERGER,
  S1_SECTIONS.BUSINESS_COMBINATION,
  S1_SECTIONS.PIPE_FINANCING,
];

/** EDGAR's filing-index page — the human-readable landing page for one accession. */
export function edgarFilingUrl(cik: number, accessionNumber: string): string {
  const bare = accessionNumber.replaceAll("-", "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${bare}/${accessionNumber}-index.htm`;
}

/** EDGAR's filing browser for one filer — every filing, newest first. */
export function edgarFilingsUrl(cik: number): string {
  return (
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" +
    String(cik).padStart(10, "0") +
    "&type=&dateb=&owner=include&count=40"
  );
}

/**
 * Which file in the accession-doc cache holds this filing's body.
 *
 * Mirrors `ProcessAccessionDocFormTask`'s own escalation, through the helpers
 * that task exports, so the viewer opens the file the extractor parsed. Reading
 * the primary document for an S-1 instead would show a cover page and report
 * every section as missing — a viewer that disagrees with the pipeline about
 * which bytes are the filing is worse than no viewer.
 */
export async function resolveBodyFileName(filing: Filing): Promise<string | undefined> {
  const form = filing.form ?? "";
  if (form !== "" && isFullSubmissionForm(form)) {
    return fullSubmissionFileName(filing.accession_number);
  }
  if (
    isSpacNarrativeTrigger8K(form, filing.items) &&
    (await new SpacRepo().getSpac(filing.cik)) !== undefined
  ) {
    return fullSubmissionFileName(filing.accession_number);
  }
  return resolvePrimaryDocName(filing.primary_doc);
}

/** The filing row for an accession, preferring the copy filed under `cik`. */
export async function findFiling(
  cik: number,
  accessionNumber: string
): Promise<Filing | undefined> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const rows = (await repo.query({ accession_number: accessionNumber })) ?? [];
  // 25-NSE / Form 25 live under the exchange CIK as well as the issuer's, so
  // prefer the row that belongs to the issuer being inspected.
  return rows.find((f) => f.cik === cik) ?? rows[0];
}

/**
 * Load and convert one filing's body.
 *
 * `includeText` is false for the process page's per-step summary, which wants
 * only the "is it cached, how big is it, how many sections does it segment
 * into" line — a 3.2 MB prospectus rendered to markdown for each of fifty steps
 * is minutes of work nobody asked for.
 */
export async function loadFilingDocument(args: {
  readonly cik: number;
  readonly accessionNumber: string;
  readonly includeText?: boolean;
}): Promise<FilingDocument> {
  const { cik, accessionNumber } = args;
  const filing = await findFiling(cik, accessionNumber);
  const base = {
    cik,
    accessionNumber,
    form: filing?.form ?? "",
    filingDate: filing?.filing_date ?? null,
    edgarUrl: edgarFilingUrl(cik, accessionNumber),
    raw: "",
    markdown: "",
    sections: [] as readonly DocumentSection[],
    bytes: 0,
    cached: false,
  };
  if (filing === undefined) {
    return { ...base, fileName: undefined, path: undefined, error: "filing not ingested" };
  }

  const fileName = await resolveBodyFileName(filing);
  if (fileName === undefined) {
    return { ...base, fileName, path: undefined, error: "filing names no primary document" };
  }
  if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
    return { ...base, fileName, path: undefined, error: "SEC_RAW_DATA_FOLDER is not configured" };
  }
  const path = cachedAccessionDocPath(
    globalServiceRegistry.get(SEC_RAW_DATA_FOLDER),
    cik,
    accessionNumber,
    fileName
  );
  if (path === undefined) {
    return { ...base, fileName, path, error: `unsafe document name ${JSON.stringify(fileName)}` };
  }

  let bytes = 0;
  try {
    bytes = (await stat(path)).size;
  } catch {
    return {
      ...base,
      fileName,
      path,
      error: "not in the accession-doc cache — run `sec spac download registration`",
    };
  }

  if (args.includeText !== true) {
    return { ...base, fileName, path, cached: true, bytes, error: "" };
  }

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (e) {
    return {
      ...base,
      fileName,
      path,
      cached: true,
      bytes,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  try {
    const doc = parseEdgarHtml(raw, `${filing.form ?? ""} ${accessionNumber}`);
    const segmented = new DocumentTreeSegmenter().segment(doc);
    return {
      ...base,
      fileName,
      path,
      cached: true,
      bytes,
      error: "",
      raw,
      markdown: renderMarkdown(doc),
      sections: segmented.map((s) => ({
        name: String(s.name),
        chars: s.text.length,
        text: s.text,
      })),
    };
  } catch (e) {
    // The bytes are still worth showing: a converter failure is precisely when
    // an operator wants to look at the source it choked on.
    return {
      ...base,
      fileName,
      path,
      cached: true,
      bytes,
      raw,
      error: `conversion failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
