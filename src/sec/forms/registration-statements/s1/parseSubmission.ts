/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Parsed values from a filing's SGML submission header. All fields nullable. */
export interface FormS1Header {
  readonly sic: number | null;
  readonly sicDescription: string | null;
  readonly cik: number | null;
  readonly companyName: string | null;
  readonly filingDate: string | null; // YYYYMMDD as filed
}

export interface FormS1Parsed {
  readonly header: FormS1Header;
  readonly html: string;
  /** Standalone XBRL instance document (EX-101.INS) body, when the submission carries one. */
  readonly xbrlInstanceXml: string | null;
  /**
   * The `EX-FILING FEES` exhibit body, when present. Since the SEC's filing-fee
   * modernization the fee table lives in this separate exhibit (not on the cover
   * page) and is iXBRL-tagged against the `ffd` taxonomy.
   */
  readonly feeExhibitHtml: string | null;
}

function headerSlice(txt: string): string {
  const end = txt.indexOf("</SEC-HEADER>");
  if (end !== -1) return txt.slice(0, end);
  const firstDoc = txt.indexOf("<DOCUMENT>");
  return firstDoc !== -1 ? txt.slice(0, firstDoc) : txt;
}

/** Body after the SGML `</SEC-HEADER>` boundary, else the whole input. */
function bodyAfterHeader(txt: string): string {
  const end = txt.indexOf("</SEC-HEADER>");
  return end !== -1 ? txt.slice(end + "</SEC-HEADER>".length) : txt;
}

/**
 * Parses an EDGAR submission header. Handles both dialects seen in practice:
 *
 * 1. The **public** full-submission `.txt` (served at
 *    `…/<accession>.txt`), whose `<SEC-HEADER>` block is a human-readable dump
 *    (`CENTRAL INDEX KEY:`, `COMPANY CONFORMED NAME:`, `FILED AS OF DATE:`,
 *    `STANDARD INDUSTRIAL CLASSIFICATION: … [NNNN]`).
 * 2. The **dissemination** `.nc` header (the members of the daily Feed
 *    tarballs, cached by `BootstrapAccessionDocsTask`), which is tagged SGML
 *    (`<CIK>`, `<CONFORMED-NAME>`, `<FILING-DATE>`, `<ASSIGNED-SIC>`) with no
 *    human-readable lines. The document bodies (`<DOCUMENT>…<TEXT>`) are
 *    identical across both dialects; only the header differs.
 *
 * Each field tries the human-readable form first, then the tagged form, so the
 * same parser reads a network `.txt` and a cached `.nc` identically. The tagged
 * fallbacks are line-anchored (`^…`, multiline) so `<CIK>` does not match
 * `<OWNER-CIK>` and `<CONFORMED-NAME>` does not match `<FORMER-CONFORMED-NAME>`;
 * the first match is the primary filer (the registration subject). Tolerant:
 * any missing field is null. (`.nc` carries only the numeric SIC, so
 * `sicDescription` stays null there.)
 */
export function parseSecHeader(txt: string): FormS1Header {
  const head = headerSlice(txt);

  let sic: number | null = null;
  let sicDescription: string | null = null;
  const sicLine = head.match(/STANDARD INDUSTRIAL CLASSIFICATION:\s*([^\[\n\r]*?)\s*\[(\d+)\]/i);
  if (sicLine) {
    sicDescription = sicLine[1].trim() || null;
    sic = Number(sicLine[2]);
  } else {
    const tagged = head.match(/<ASSIGNED-SIC>\s*(\d+)/i);
    if (tagged) sic = Number(tagged[1]);
  }

  const cikMatch = head.match(/CENTRAL INDEX KEY:\s*(\d+)/i) ?? head.match(/^<CIK>\s*(\d+)/im);
  const cik = cikMatch ? Number(cikMatch[1]) : null;

  const nameMatch =
    head.match(/COMPANY CONFORMED NAME:\s*(.+?)\s*[\r\n]/i) ??
    head.match(/^<CONFORMED-NAME>\s*(.+?)\s*$/im);
  const companyName = nameMatch ? nameMatch[1].trim() : null;

  const dateMatch =
    head.match(/FILED AS OF DATE:\s*(\d{8})/i) ?? head.match(/^<FILING-DATE>\s*(\d{8})/im);
  const filingDate = dateMatch ? dateMatch[1] : null;

  return { sic, sicDescription, cik, companyName, filingDate };
}

interface DocBlock {
  readonly type: string | null;
  readonly sequence: number | null;
  readonly filename: string | null;
  readonly description: string | null;
  readonly body: string;
}

function parseDocuments(txt: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  const re = /<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt)) !== null) {
    const inner = m[1];
    const type = inner.match(/<TYPE>\s*([^\r\n<]+)/i)?.[1].trim() ?? null;
    const seq = inner.match(/<SEQUENCE>\s*(\d+)/i)?.[1];
    const filename = inner.match(/<FILENAME>\s*([^\r\n<]+)/i)?.[1].trim() ?? null;
    const description = inner.match(/<DESCRIPTION>\s*([^\r\n<]+)/i)?.[1].trim() ?? null;
    const textMatch = inner.match(/<TEXT>\s*([\s\S]*?)\s*<\/TEXT>/i);
    const body = textMatch ? textMatch[1] : inner;
    blocks.push({
      type,
      sequence: seq ? Number(seq) : null,
      filename,
      description,
      body,
    });
  }
  return blocks;
}

export interface SubmissionExhibit {
  readonly type: string;
  readonly description: string;
  readonly filename: string;
}

const SKIP_EXHIBIT_TYPES = /^(8-K(\/A)?|GRAPHIC|XML)$/i;
const SKIP_EXHIBIT_TYPE_PREFIX = /^EX-101\b/i;
const EXHIBIT_DETAIL_MAX = 1024;

export function parseSubmissionExhibits(txt: string): SubmissionExhibit[] {
  const out: SubmissionExhibit[] = [];
  for (const d of parseDocuments(txt)) {
    if (d.type == null) continue;
    const type = d.type.trim();
    if (SKIP_EXHIBIT_TYPES.test(type) || SKIP_EXHIBIT_TYPE_PREFIX.test(type)) continue;
    if (!/^EX-/i.test(type)) continue;
    out.push({
      type,
      description: (d.description ?? "").trim(),
      filename: (d.filename ?? "").trim(),
    });
  }
  return out;
}

export function formatExhibitDetail(exhibits: readonly SubmissionExhibit[]): string | null {
  if (exhibits.length === 0) return null;
  const lines = exhibits.map((e) => {
    const raw = e.description.trim();
    const comma = raw.indexOf(",");
    const short = (comma === -1 ? raw : raw.slice(0, comma)).trim() || e.type;
    const file = e.filename.trim();
    return file === "" ? `${e.type} ${short}` : `${e.type} ${short}\t${file}`;
  });
  let joined = lines.join("\n");
  if (joined.length <= EXHIBIT_DETAIL_MAX) return joined;
  while (joined.length > EXHIBIT_DETAIL_MAX) {
    const cut = joined.lastIndexOf("\n");
    if (cut <= 0) return joined.slice(0, EXHIBIT_DETAIL_MAX);
    joined = joined.slice(0, cut);
  }
  return joined;
}

/**
 * Finds a standalone XBRL instance document among the submission's members:
 * the EDGAR exhibit type `EX-101.INS`, or any `.xml` member whose body opens
 * an `xbrl` root element (filers vary in how they label the exhibit).
 */
function findXbrlInstance(docs: readonly DocBlock[]): string | null {
  const byType = docs.find((d) => d.type !== null && d.type.toUpperCase().startsWith("EX-101.INS"));
  if (byType) return byType.body;
  const byFilename = docs.find(
    (d) =>
      d.filename !== null &&
      d.filename.toLowerCase().endsWith(".xml") &&
      /<(\w+:)?xbrl[\s>]/i.test(d.body)
  );
  return byFilename ? byFilename.body : null;
}

/** Finds the iXBRL-tagged `EX-FILING FEES` exhibit (filing-fee table) when present. */
function findFeeExhibit(docs: readonly DocBlock[]): string | null {
  const doc = docs.find(
    (d) => d.type !== null && d.type.toUpperCase().startsWith("EX-FILING FEES")
  );
  return doc ? doc.body : null;
}

/**
 * Parses a full-submission `.txt` (or a bare primary-doc body). Returns the
 * SGML header values and the primary document body (the block whose `<TYPE>`
 * matches `form`, else `<SEQUENCE> 1`, else the first). When there is no
 * `<DOCUMENT>` envelope, the whole input is the body and the header is all-null.
 */
export function parseRegistrationSubmission(form: string, txt: string): FormS1Parsed {
  const header = parseSecHeader(txt);
  const docs = parseDocuments(txt);
  if (docs.length === 0) {
    // No <DOCUMENT> envelope: treat the input as a bare body. If a SEC-HEADER is
    // present (a malformed/truncated submission missing its document blocks), drop
    // it so the header lines aren't fed to the HTML converter as body text.
    const html = bodyAfterHeader(txt);
    return { header, html, xbrlInstanceXml: null, feeExhibitHtml: null };
  }
  const byType = docs.find((d) => d.type !== null && d.type.toUpperCase() === form.toUpperCase());
  const bySeq = docs.find((d) => d.sequence === 1);
  const primary = byType ?? bySeq ?? docs[0];
  return {
    header,
    html: primary.body,
    xbrlInstanceXml: findXbrlInstance(docs),
    feeExhibitHtml: findFeeExhibit(docs),
  };
}

/** Primary document body + EX-99.x exhibit bodies sliced from an 8-K submission. */
export interface EightKSubmissionDocs {
  readonly primaryHtml: string;
  readonly exhibitsHtml: readonly string[];
}

/**
 * Slices a full-submission `.txt` (or bare primary-doc body) into the primary
 * document and its `EX-99.x` exhibits. The primary is the block whose `<TYPE>`
 * equals `form`, else `<SEQUENCE> 1`, else the first; exhibits are every block
 * whose `<TYPE>` starts with `EX-99`. With no `<DOCUMENT>` envelope the whole
 * input is the primary body and there are no exhibits.
 */
export function parseEightKSubmission(form: string, txt: string): EightKSubmissionDocs {
  const docs = parseDocuments(txt);
  if (docs.length === 0) {
    const html = bodyAfterHeader(txt);
    return { primaryHtml: html, exhibitsHtml: [] };
  }
  const byType = docs.find((d) => d.type !== null && d.type.toUpperCase() === form.toUpperCase());
  const bySeq = docs.find((d) => d.sequence === 1);
  const primary = byType ?? bySeq ?? docs[0];
  const exhibitsHtml = docs
    .filter((d) => d.type !== null && d.type.toUpperCase().startsWith("EX-99"))
    .map((d) => d.body);
  return { primaryHtml: primary.body, exhibitsHtml };
}
