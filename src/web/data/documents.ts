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

/** One document's conversion, as the cache holds it. */
interface ConvertedDocument {
  readonly raw: string;
  readonly markdown: string;
  readonly sections: readonly DocumentSection[];
  /** Conversion failure, or "" — cached too, so a broken document is not re-parsed on every panel. */
  readonly error: string;
  readonly weight: number;
}

/**
 * Converted documents, keyed by path + size + mtime so a re-download evicts.
 *
 * The panels on the document tab are fetched one at a time as they are opened,
 * and each fetch would otherwise re-read and re-convert the whole filing:
 * Bridgetown's 3.2 MB prospectus takes seconds and is typeset inside 295
 * tables. Bounded by BYTES rather than by count because that is what actually
 * has to fit — one entry is the raw text plus its markdown plus every section,
 * which for that filing is about 4 MB and for a Form 4 is a few KB.
 */
const CONVERSION_CACHE_BYTES = 96 * 1024 * 1024;
const conversionCache = new Map<string, ConvertedDocument>();
let conversionCacheBytes = 0;

function cacheConversion(key: string, value: ConvertedDocument): ConvertedDocument {
  const existing = conversionCache.get(key);
  if (existing !== undefined) {
    conversionCache.delete(key);
    conversionCacheBytes -= existing.weight;
  }
  conversionCache.set(key, value);
  conversionCacheBytes += value.weight;
  // Map iterates in insertion order and every read re-inserts, so the first
  // key is the least recently used.
  while (conversionCacheBytes > CONVERSION_CACHE_BYTES && conversionCache.size > 1) {
    const oldest = conversionCache.keys().next().value;
    if (oldest === undefined) break;
    conversionCacheBytes -= conversionCache.get(oldest)?.weight ?? 0;
    conversionCache.delete(oldest);
  }
  return value;
}

/** Drop every cached conversion. For tests, and for a `--force` re-download. */
export function clearConversionCacheForTesting(): void {
  conversionCache.clear();
  conversionCacheBytes = 0;
}

/**
 * Read and convert one cached document, memoized.
 *
 * A conversion FAILURE is cached alongside a success: re-parsing a document
 * that already threw, once per panel the reader opens, spends the same seconds
 * to reach the same error.
 */
async function convertDocument(args: {
  readonly path: string;
  readonly title: string;
  readonly size: number;
  readonly mtimeMs: number;
}): Promise<ConvertedDocument> {
  const key = `${args.path}:${args.size}:${args.mtimeMs}`;
  const hit = conversionCache.get(key);
  if (hit !== undefined) {
    // Re-insert so the LRU order reflects this read.
    conversionCache.delete(key);
    conversionCache.set(key, hit);
    return hit;
  }

  const raw = await readFile(args.path, "utf-8");
  try {
    const doc = parseEdgarHtml(raw, args.title);
    const segmented = new DocumentTreeSegmenter().segment(doc);
    const markdown = renderMarkdown(doc);
    const sections = segmented.map((s) => ({
      name: String(s.name),
      chars: s.text.length,
      text: s.text,
    }));
    const weight =
      raw.length + markdown.length + sections.reduce((sum, sec) => sum + sec.text.length, 0);
    return cacheConversion(key, { raw, markdown, sections, error: "", weight });
  } catch (e) {
    // The bytes are still worth keeping: a converter failure is precisely when
    // an operator wants to look at the source it choked on.
    return cacheConversion(key, {
      raw,
      markdown: "",
      sections: [],
      error: `conversion failed: ${e instanceof Error ? e.message : String(e)}`,
      weight: raw.length,
    });
  }
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
  /**
   * The already-loaded filing row, when the caller has one. The process page
   * builds a card per step and would otherwise re-query the same row it just
   * iterated — one extra round trip per filing, on timelines that run to
   * thousands for a de-SPAC'd operating company.
   */
  readonly filing?: Filing | undefined;
}): Promise<FilingDocument> {
  const { cik, accessionNumber } = args;
  const filing = args.filing ?? (await findFiling(cik, accessionNumber));
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
  let mtimeMs = 0;
  try {
    const stats = await stat(path);
    bytes = stats.size;
    mtimeMs = stats.mtimeMs;
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

  let converted: ConvertedDocument;
  try {
    converted = await convertDocument({
      path,
      title: `${filing.form ?? ""} ${accessionNumber}`,
      size: bytes,
      mtimeMs,
    });
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

  return {
    ...base,
    fileName,
    path,
    cached: true,
    bytes,
    error: converted.error,
    raw: converted.raw,
    markdown: converted.markdown,
    sections: converted.sections,
  };
}

/** The parts of a converted document the viewer fetches one at a time. */
export type DocumentPart = "markdown" | "raw" | "section";

/**
 * One panel's text, fetched when the reader opens it.
 *
 * The document tab used to ship every section, the whole markdown and the whole
 * source inside the page — 745 KB of HTML for a single S-1, almost all of it
 * behind collapsed `<details>` nobody had opened. The counts are still computed
 * on page load (they are what tells you a section is missing), but the text
 * itself is now a request per panel.
 */
export async function loadDocumentPart(args: {
  readonly cik: number;
  readonly accessionNumber: string;
  readonly part: DocumentPart;
  /** Section name, required when `part` is `"section"`. */
  readonly name?: string | undefined;
  /** Skip the display cap. The panel never asks for this; a direct URL can. */
  readonly full?: boolean | undefined;
}): Promise<{ readonly text: string; readonly error: string }> {
  const doc = await loadFilingDocument({
    cik: args.cik,
    accessionNumber: args.accessionNumber,
    includeText: true,
  });
  if (doc.error !== "" && doc.raw === "") return { text: "", error: doc.error };
  const cap = (text: string): { readonly text: string; readonly error: string } => ({
    text: args.full === true ? text : capForDisplay(text),
    error: "",
  });
  if (args.part === "raw") return cap(doc.raw);
  if (args.part === "markdown") {
    return doc.markdown === ""
      ? { text: "", error: doc.error === "" ? "the converter produced no markdown" : doc.error }
      : cap(doc.markdown);
  }
  const section = doc.sections.find((s) => s.name === args.name);
  if (section === undefined) {
    return { text: "", error: `no "${args.name ?? ""}" section in this document` };
  }
  return cap(section.text);
}

/**
 * Characters a panel renders before it is cut.
 *
 * A 3.2 MB source in one `<pre>` is not something anyone reads; the cap is what
 * keeps opening the wrong panel from wedging the tab. The cut says how to get
 * the rest rather than just announcing itself — a truncation with no way past
 * it is the reason people go looking for the file on disk.
 */
export const DOCUMENT_PART_PREVIEW_CHARS = 200_000;

function capForDisplay(text: string): string {
  if (text.length <= DOCUMENT_PART_PREVIEW_CHARS) return text;
  return (
    `${text.slice(0, DOCUMENT_PART_PREVIEW_CHARS)}\n\n` +
    `… truncated at ${DOCUMENT_PART_PREVIEW_CHARS.toLocaleString()} of ` +
    `${text.length.toLocaleString()} characters — add &full=1 to this panel's ` +
    `/api/document URL for the whole thing.`
  );
}
