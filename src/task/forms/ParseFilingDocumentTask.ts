/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { globalServiceRegistry, Task } from "workglow";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { TypeAccessionNumber } from "../../sec/edgar/accessionNumber";
import { ALL_FORMS_MAP, isFormParsingSupported } from "../../sec/forms/all-forms";
import { formHasExtractor } from "../../sec/forms/formExtractors";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../../util/accessionDocPath";
import { fullSubmissionFileName, submissionFetchKind } from "./submissionFetchPolicy";

export type ParseFilingDocumentTaskInput = {
  readonly accessionNumber: string;
  readonly cik?: number;
  /** Overrides the filing row's form, for trying one parser against another's document. */
  readonly form?: string;
  /** Overrides the cached file to read, for reaching an exhibit by name. */
  readonly fileName?: string;
};

export type ParseFilingDocumentTaskOutput = {
  /** Whether a parser ran and returned something. */
  readonly ok: boolean;
  readonly form: string;
  /** The cached file that was read, or "" when nothing was. */
  readonly docFile: string;
  readonly chars: number;
  /**
   * Whether anything in this deployment would EXTRACT this form. False is the
   * ordinary case here — it is why this task exists — and saying so keeps the
   * output from reading as a pipeline result.
   */
  readonly hasExtractor: boolean;
  /** The parser's output, or undefined when it produced none. */
  readonly parsed: unknown;
  /** Why there is no parse, or "" when there is one. */
  readonly error: string;
};

/**
 * Run one form's parser over one already-cached filing and show what it
 * produced. An inspection tool for whoever is working on the parser, and
 * nothing else.
 *
 * WRITES NOTHING. No storage, no `extractor_runs` row, no dead letter, no
 * version slot, no observation — and no fetch, so not even the document cache
 * is touched. That is the whole reason it can exist alongside the pipeline: a
 * parse that cannot record anything cannot become a second, untracked
 * processing path, and cannot make a filing look processed to the anti-joins
 * that decide what gets swept.
 *
 * It is also unreachable from processing. Nothing dispatches it, no sweep flag
 * turns into it, and it is not what `sec fetch doc` runs — reaching it takes
 * naming it: `sec-base task run ParseFilingDocumentTask --input-json '{...}'`.
 *
 * The case it serves is a form this package parses and does not read — a proxy
 * statement whose extractor a consumer package supplies. Every processing path
 * skips or refuses such a form, so without this there would be no way to see
 * the parser's output at all, and "register an extractor first" is not an
 * answer for someone changing the parser.
 *
 * Reporting is honest in both directions: nothing cached, no parser class, a
 * parser that throws and a parser that returns nothing are four distinct
 * `error` strings with `ok: false`, rather than an empty success. A throw is
 * the interesting case while developing, so it is surfaced rather than
 * swallowed — and returned as data, so `--output json` carries it.
 */
export class ParseFilingDocumentTask extends Task<
  ParseFilingDocumentTaskInput,
  ParseFilingDocumentTaskOutput
> {
  static readonly type = "ParseFilingDocumentTask";
  static readonly category = "SEC";
  static readonly title = "Parse a filing document";
  static readonly description =
    "Runs a form's parser over one cached filing and prints the result; writes nothing and fetches nothing (inspection only)";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      accessionNumber: TypeAccessionNumber(),
      cik: Type.Optional(TypeSecCik()),
      form: Type.Optional(Type.String()),
      fileName: Type.Optional(Type.String()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      ok: Type.Boolean(),
      form: Type.String(),
      docFile: Type.String(),
      chars: Type.Integer(),
      hasExtractor: Type.Boolean(),
      parsed: Type.Unknown(),
      error: Type.String(),
    });
  }

  /** Reads one cached file, or undefined when it is not on disk. */
  private async readCached(
    cik: number,
    accessionNumber: string,
    fileName: string
  ): Promise<string | undefined> {
    if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) return undefined;
    const fullPath = cachedAccessionDocPath(
      globalServiceRegistry.get(SEC_RAW_DATA_FOLDER),
      cik,
      accessionNumber,
      fileName
    );
    if (fullPath === undefined) return undefined;
    try {
      const text = await readFile(fullPath, "utf-8");
      return text.length > 0 ? text : undefined;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
      throw err;
    }
  }

  async execute(input: ParseFilingDocumentTaskInput): Promise<ParseFilingDocumentTaskOutput> {
    const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const filings = (await filingRepo.query({ accession_number: input.accessionNumber })) ?? [];
    const filing =
      (input.cik != null ? filings.find((f) => f.cik === input.cik) : undefined) ?? filings[0];
    const cik = input.cik ?? filing?.cik;
    const form = input.form ?? filing?.form ?? "";
    const empty = {
      ok: false,
      form,
      docFile: "",
      chars: 0,
      hasExtractor: form !== "" && formHasExtractor(form),
      parsed: undefined,
      error: "",
    } as const;

    if (cik === undefined || cik === null) {
      return { ...empty, error: `No filing stored for accession ${input.accessionNumber}` };
    }
    if (form === "") {
      return { ...empty, error: `Filing ${input.accessionNumber} has no form type` };
    }

    // The same file the pipeline would have read, then the alternatives — a
    // cache populated by an older route holds the other shape for plenty of
    // filings, and a probe is a `stat`, not a request. An explicit `fileName`
    // is the only candidate, since naming one is how an exhibit is reached.
    const candidates =
      input.fileName !== undefined
        ? [input.fileName]
        : [
            ...new Set(
              [
                submissionFetchKind(form) === "full-submission"
                  ? fullSubmissionFileName(input.accessionNumber)
                  : resolvePrimaryDocName(filing?.primary_doc),
                resolvePrimaryDocName(filing?.primary_doc),
                fullSubmissionFileName(input.accessionNumber),
              ].filter((name): name is string => name !== undefined)
            ),
          ];

    let text: string | undefined;
    let docFile = "";
    for (const fileName of candidates) {
      text = await this.readCached(cik, input.accessionNumber, fileName);
      if (text !== undefined) {
        docFile = fileName;
        break;
      }
    }
    if (text === undefined) {
      return {
        ...empty,
        error:
          `Nothing cached for ${input.accessionNumber} (looked for ${candidates.join(", ")}). ` +
          `This task never fetches — ingest the filing first.`,
      };
    }

    const formCls = ALL_FORMS_MAP.get(form);
    if (formCls === undefined || !isFormParsingSupported(form)) {
      return { ...empty, docFile, chars: text.length, error: `No parser for form '${form}'` };
    }

    let parsed: unknown;
    try {
      parsed = await formCls.parse(form, text);
    } catch (err) {
      return {
        ...empty,
        docFile,
        chars: text.length,
        error: `Parse threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (parsed == null) {
      return {
        ...empty,
        docFile,
        chars: text.length,
        error: `Parser returned nothing for '${docFile}'`,
      };
    }
    return { ...empty, ok: true, docFile, chars: text.length, parsed };
  }
}
