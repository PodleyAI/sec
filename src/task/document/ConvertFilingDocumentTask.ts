/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, TaskError } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { FILING_DOCUMENT_REPOSITORY_TOKEN } from "../../storage/document/FilingDocumentSchema";
import {
  FILING_SECTION_REPOSITORY_TOKEN,
  type FilingSection,
} from "../../storage/document/FilingSectionSchema";
import type { FilingDocument } from "../../storage/document/FilingDocumentSchema";
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../../util/accessionDocPath";
import { REGISTRATION_PROSPECTUS_FORMS } from "../forms/ProcessAccessionDocFormTask";
import { SecFetchAccessionDocTask } from "../forms/SecFetchAccessionDocTask";
import {
  convertFilingSubmission,
  FILING_CONVERTER_VERSION,
  type ConvertedFilingDocument,
} from "./convertFilingDocument";

export type ConvertFilingDocumentTaskInput = {
  readonly cik: number;
  readonly accessionNumber: string;
  readonly form?: string | undefined;
  readonly filingDate?: string | undefined;
  /** Primary document filename from `filings.primary_doc`, when known. */
  readonly primaryDoc?: string | undefined;
};

export type ConvertFilingDocumentTaskOutput = {
  readonly success: boolean;
  /** Members of the submission converted: the primary document plus exhibits. */
  readonly documents: number;
  /** Sections across every converted member. */
  readonly sections: number;
  readonly chars: number;
  /** The PRIMARY document's filename, or empty when nothing was converted. */
  readonly docFile: string;
};

/** Rows per bulk write. A long S-1 runs to a few hundred sections. */
const WRITE_BATCH = 200;

/**
 * The candidate filenames for one filing, in the order they should be tried.
 *
 * The full-submission `.txt` first, always. It is the only shape that carries
 * the sibling `<DOCUMENT>` blocks, and those ARE the filing for an 8-K, whose
 * primary document is four sentences pointing at the EX-99.1 press release
 * holding the news. Reading the primary document alone stores the pointer.
 *
 * The bare primary document stays as a fallback, because a cache populated by
 * an older route holds that shape for plenty of filings and one document is
 * better than none. Such a filing converts to a single-document submission and
 * says so — {@link FilingDocument.section_count} counts what is there, not what
 * a `.txt` would have had.
 */
export function conversionCandidates(
  form: string | null | undefined,
  accessionNumber: string,
  primaryDoc: string | null | undefined
): string[] {
  const primary = resolvePrimaryDocName(primaryDoc);
  return [`${accessionNumber}.txt`, primary].filter((n): n is string => n !== undefined);
}

/** The primary document's filename, falling back to the file that was loaded. */
function primaryDocFile(converted: readonly ConvertedFilingDocument[], fallback: string): string {
  return converted.find((doc) => doc.isPrimary)?.docFile ?? fallback;
}

/**
 * Convert every narrative document of one submission to markdown and store
 * them as sections.
 *
 * Reads the on-disk fetch cache first and only reaches EDGAR on a miss, for the
 * same reason the forms pipeline does: a cache hit touches no network, so
 * putting it through the shared rate limiter would serialize every shard down
 * to one cluster-wide budget for no benefit.
 *
 * A filing that names no document, or whose document the parser yields nothing
 * from, returns `{ success: false }` rather than throwing. One unconvertible
 * filing is a gap on one page — the reader still gets the EDGAR link — and it
 * must not take down the sweep around it.
 */
export class ConvertFilingDocumentTask extends Task<
  ConvertFilingDocumentTaskInput,
  ConvertFilingDocumentTaskOutput
> {
  static readonly type = "ConvertFilingDocumentTask";
  static readonly category = "SEC";
  static readonly title = "Convert filing to markdown";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: Type.Integer(),
      accessionNumber: Type.String(),
      form: Type.Optional(Type.String()),
      filingDate: Type.Optional(Type.String()),
      primaryDoc: Type.Optional(Type.String()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
      documents: Type.Integer(),
      sections: Type.Integer(),
      chars: Type.Integer(),
      docFile: Type.String(),
    });
  }

  /** Reads a cached submission file, or undefined when it is not on disk. */
  private async readCached(
    cik: number,
    accessionNumber: string,
    fileName: string
  ): Promise<string | undefined> {
    if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) return undefined;
    const root = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const fullPath = cachedAccessionDocPath(root, cik, accessionNumber, fileName);
    if (fullPath === undefined) return undefined;
    try {
      const text = await readFile(fullPath, "utf-8");
      return text.length > 0 ? text : undefined;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
      throw err;
    }
  }

  /**
   * The filing's source text and the file it came from.
   *
   * Isolated as a protected seam so the conversion is unit-testable without a
   * filesystem or the network, matching `ProcessAccessionDocFormTask.runFetch`.
   */
  protected async loadSource(
    input: ConvertFilingDocumentTaskInput,
    context: IExecuteContext
  ): Promise<{ text: string; docFile: string } | undefined> {
    const candidates = conversionCandidates(
      input.form ?? null,
      input.accessionNumber,
      input.primaryDoc ?? null
    );
    if (candidates.length === 0) return undefined;

    for (const fileName of candidates) {
      const cached = await this.readCached(input.cik, input.accessionNumber, fileName);
      if (cached !== undefined) return { text: cached, docFile: fileName };
    }

    // Nothing cached: fetch the file the forms pipeline would have fetched,
    // which is the first candidate.
    const fileName = candidates[0];
    const fetchTask = context.own(
      new SecFetchAccessionDocTask(
        { cik: input.cik, accessionNumber: input.accessionNumber, fileName },
        { title: `Fetch ${input.accessionNumber} ${fileName}` }
      )
    );
    try {
      const text = (await fetchTask.run()).text as string | undefined;
      return text ? { text, docFile: fileName } : undefined;
    } finally {
      context.disown(fetchTask);
    }
  }

  async execute(
    input: ConvertFilingDocumentTaskInput,
    context: IExecuteContext
  ): Promise<ConvertFilingDocumentTaskOutput> {
    if (!input.accessionNumber) throw new TaskError("Invalid input");
    const empty = { success: false, documents: 0, sections: 0, chars: 0, docFile: "" } as const;

    const source = await this.loadSource(input, context);
    if (source === undefined) return empty;

    const converted = convertFilingSubmission(
      input.form ?? null,
      input.accessionNumber,
      source.text,
      source.docFile
    );
    // A submission that parses to nothing is not a conversion. Storing header
    // rows with no sections would make the sweep consider it done and would
    // render as a blank page rather than as the honest "not converted" state.
    if (converted.length === 0) return empty;
    // Nor is one whose primary document parsed to nothing while an exhibit did.
    // The anti-join keys on the primary row, so a submission with no primary
    // would be re-selected on every sweep forever.
    if (!converted.some((doc) => doc.isPrimary)) return empty;

    if (isDryRun()) {
      const sections = converted.reduce((sum, doc) => sum + doc.sections.length, 0);
      console.log(
        `Would convert ${input.accessionNumber} (${source.docFile}) to ` +
          `${converted.length} documents, ${sections} sections`
      );
      return {
        success: true,
        documents: converted.length,
        sections,
        chars: converted.reduce((sum, doc) => sum + doc.charCount, 0),
        docFile: primaryDocFile(converted, source.docFile),
      };
    }

    const sectionRepo = globalServiceRegistry.get(FILING_SECTION_REPOSITORY_TOKEN);
    const documentRepo = globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN);

    // Both tables are replaced wholesale for this accession, not merged. A
    // re-conversion can produce FEWER documents or fewer sections than the last
    // one — a filer's exhibit dropped from the skip list, a heading no longer
    // recognised — and merging would leave the tail of the previous render
    // stranded behind the new one with no way to notice.
    const key = { cik: input.cik, accession_number: input.accessionNumber };
    await sectionRepo.deleteSearch(key as never);
    await documentRepo.deleteSearch(key as never);

    const convertedAt = new Date().toISOString();
    const headers: FilingDocument[] = [];
    let written = 0;
    let sectionTotal = 0;
    let charTotal = 0;
    for (const doc of converted) {
      const rows: FilingSection[] = doc.sections.map((section) => ({
        cik: input.cik,
        accession_number: input.accessionNumber,
        doc_file: doc.docFile,
        ordinal: section.ordinal,
        slug: section.slug,
        title: section.title,
        depth: section.depth,
        char_count: section.markdown.length,
        markdown: section.markdown,
      }));
      for (let i = 0; i < rows.length; i += WRITE_BATCH) {
        await sectionRepo.putBulk(rows.slice(i, i + WRITE_BATCH));
      }
      written += 1;
      sectionTotal += rows.length;
      charTotal += doc.charCount;
      context.updateProgress(
        Math.floor((written / converted.length) * 100),
        `${written}/${converted.length} documents`
      );
      headers.push({
        cik: input.cik,
        accession_number: input.accessionNumber,
        doc_file: doc.docFile,
        doc_type: doc.docType,
        description: doc.description,
        sequence: doc.sequence,
        is_primary: doc.isPrimary,
        form: input.form ?? null,
        filing_date: input.filingDate ?? null,
        title: doc.title,
        section_count: rows.length,
        char_count: doc.charCount,
        converter_version: FILING_CONVERTER_VERSION,
        converted_at: convertedAt,
      });
    }

    // Header rows written LAST, and the PRIMARY last of all, because the
    // sweep's anti-join keys on the primary row: its presence has to mean every
    // document behind it is already stored. Writing it first would let an
    // interruption mark a filing done with half a submission on disk, and
    // nothing would ever revisit it.
    for (const header of headers.filter((h) => !h.is_primary)) await documentRepo.put(header);
    for (const header of headers.filter((h) => h.is_primary)) await documentRepo.put(header);

    return {
      success: true,
      documents: written,
      sections: sectionTotal,
      chars: charTotal,
      docFile: primaryDocFile(converted, source.docFile),
    };
  }
}
