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
}

function headerSlice(txt: string): string {
  const end = txt.indexOf("</SEC-HEADER>");
  if (end !== -1) return txt.slice(0, end);
  const firstDoc = txt.indexOf("<DOCUMENT>");
  return firstDoc !== -1 ? txt.slice(0, firstDoc) : txt;
}

/**
 * Parses the human-readable EDGAR submission header (and the older tagged
 * `<ASSIGNED-SIC>` form as a fallback). Tolerant: any missing field is null.
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

  const cikMatch = head.match(/CENTRAL INDEX KEY:\s*(\d+)/i);
  const cik = cikMatch ? Number(cikMatch[1]) : null;

  const nameMatch = head.match(/COMPANY CONFORMED NAME:\s*(.+?)\s*[\r\n]/i);
  const companyName = nameMatch ? nameMatch[1].trim() : null;

  const dateMatch = head.match(/FILED AS OF DATE:\s*(\d{8})/i);
  const filingDate = dateMatch ? dateMatch[1] : null;

  return { sic, sicDescription, cik, companyName, filingDate };
}

interface DocBlock {
  readonly type: string | null;
  readonly sequence: number | null;
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
    const textMatch = inner.match(/<TEXT>\s*([\s\S]*?)\s*<\/TEXT>/i);
    const body = textMatch ? textMatch[1] : inner;
    blocks.push({ type, sequence: seq ? Number(seq) : null, body });
  }
  return blocks;
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
    const end = txt.indexOf("</SEC-HEADER>");
    const html = end !== -1 ? txt.slice(end + "</SEC-HEADER>".length) : txt;
    return { header, html };
  }
  const byType = docs.find((d) => d.type !== null && d.type.toUpperCase() === form.toUpperCase());
  const bySeq = docs.find((d) => d.sequence === 1);
  const primary = byType ?? bySeq ?? docs[0];
  return { header, html: primary.body };
}
