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
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../../util/accessionDocPath";
import { REGISTRATION_PROSPECTUS_FORMS } from "../forms/ProcessAccessionDocFormTask";
import { SecFetchAccessionDocTask } from "../forms/SecFetchAccessionDocTask";
import { convertFilingDocument, FILING_CONVERTER_VERSION } from "./convertFilingDocument";

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
  readonly sections: number;
  readonly chars: number;
  /** The submission file converted, or empty when nothing was. */
  readonly docFile: string;
};

/** Rows per bulk write. A long S-1 runs to a few hundred sections. */
const WRITE_BATCH = 200;

/**
 * The candidate filenames for one filing, in the order they should be tried.
 *
 * The prospectus forms are cached by the forms pipeline as the full submission
 * `.txt` — `Form.parse()` needs the sibling `<DOCUMENT>` blocks, not just the
 * primary document — so for those the `.txt` is what is already on disk and
 * asking for the primary document alone would be a guaranteed cache miss and a
 * needless EDGAR fetch. Everything else is cached as its primary document.
 *
 * Both are listed either way, because a cache populated by a different route
 * (the Feed tarball bootstrap, an earlier sweep) may hold the other one, and
 * the converter reads both shapes.
 */
export function conversionCandidates(
  form: string | null | undefined,
  accessionNumber: string,
  primaryDoc: string | null | undefined
): string[] {
  const fullSubmission = `${accessionNumber}.txt`;
  const primary = resolvePrimaryDocName(primaryDoc);
  const prospectus = form !== null && form !== undefined && REGISTRATION_PROSPECTUS_FORMS.has(form);
  const ordered = prospectus ? [fullSubmission, primary] : [primary, fullSubmission];
  return ordered.filter((name): name is string => name !== undefined);
}

/**
 * Convert one filing's primary document to markdown and store it as sections.
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
    const empty = { success: false, sections: 0, chars: 0, docFile: "" } as const;

    const source = await this.loadSource(input, context);
    if (source === undefined) return empty;

    const converted = convertFilingDocument(input.form ?? null, input.accessionNumber, source.text);
    // A filing that parses to nothing is not a conversion. Storing a header row
    // with no sections would make the sweep consider it done and would render
    // as a blank page rather than as the honest "not converted" state.
    if (converted.sections.length === 0) return empty;

    if (isDryRun()) {
      console.log(
        `Would convert ${input.accessionNumber} (${source.docFile}) to ${converted.sections.length} sections`
      );
      return {
        success: true,
        sections: converted.sections.length,
        chars: converted.charCount,
        docFile: source.docFile,
      };
    }

    const sectionRepo = globalServiceRegistry.get(FILING_SECTION_REPOSITORY_TOKEN);
    const documentRepo = globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN);

    // Sections are replaced wholesale, not merged: a re-conversion can produce
    // FEWER sections than the last one, and merging would leave the tail of the
    // previous render stranded behind the new document with no way to notice.
    await sectionRepo.deleteSearch({
      cik: input.cik,
      accession_number: input.accessionNumber,
    } as never);

    const rows: FilingSection[] = converted.sections.map((section) => ({
      cik: input.cik,
      accession_number: input.accessionNumber,
      ordinal: section.ordinal,
      slug: section.slug,
      title: section.title,
      depth: section.depth,
      char_count: section.markdown.length,
      markdown: section.markdown,
    }));
    for (let i = 0; i < rows.length; i += WRITE_BATCH) {
      await sectionRepo.putBulk(rows.slice(i, i + WRITE_BATCH));
      context.updateProgress(
        Math.floor((Math.min(i + WRITE_BATCH, rows.length) / rows.length) * 100),
        `${Math.min(i + WRITE_BATCH, rows.length)}/${rows.length} sections`
      );
    }

    // Written LAST, so the header row's existence means the sections behind it
    // are already there. The sweep's anti-join keys on this row, so writing it
    // first would let an interruption mark a filing done with half a document
    // stored — and nothing would ever revisit it.
    await documentRepo.put({
      cik: input.cik,
      accession_number: input.accessionNumber,
      doc_file: source.docFile,
      form: input.form ?? null,
      filing_date: input.filingDate ?? null,
      title: converted.title,
      section_count: rows.length,
      char_count: converted.charCount,
      converter_version: FILING_CONVERTER_VERSION,
      converted_at: new Date().toISOString(),
    });

    return {
      success: true,
      sections: rows.length,
      chars: converted.charCount,
      docFile: source.docFile,
    };
  }
}
