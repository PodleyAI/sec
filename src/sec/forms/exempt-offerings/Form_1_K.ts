/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import Value from "typebox/value";
import { Form } from "../Form";
import { Form1K, Form1KSchema, Form1KSubmission, Form1KSubmissionSchema } from "./Form_1_K.schema";
import { parseRegAFinancialStatements, type RegAStatement } from "./regAFinancialStatements";
import { selectRegACoverDocument, selectRegAReportDocument } from "./regAReportDocument";

/**
 * A parsed Form 1-K: the XSD cover page, plus the annual report's financial
 * statements.
 *
 * The two come from DIFFERENT documents of the same submission, which is the
 * whole reason 1-K is fetched as the full `.txt`. The cover is
 * `primary_doc.xml`, and its XSD has no financial elements at all — which is why
 * 1-K produced 0 financial rows across all 2,997 filings. The annual report
 * lives beside it as `<TYPE>PART II`.
 */
export interface ParsedForm1K {
  readonly cover: Form1K;
  readonly statements: readonly RegAStatement[];
}

export class Form_1_K extends Form {
  static readonly name = "Annual Report (Regulation A)";
  static readonly description = "Annual report pursuant to Regulation A.";
  static readonly forms = ["1-K", "1-K/A"] as const;

  /**
   * Parses a 1-K from its FULL SUBMISSION `.txt`.
   *
   * Accepts a bare `primary_doc.xml` too, so a caller holding just the cover
   * document (a fixture, a cached primary doc from before the fetch was
   * escalated) still parses — it simply yields no statements. The two are told
   * apart by looking for the SGML `<DOCUMENT>` envelope rather than by trusting
   * the caller, because both arrive as a string and getting it wrong is silent.
   */
  static async parse(form: (typeof Form_1_K.forms)[number], text: string): Promise<ParsedForm1K> {
    if (!Form_1_K.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }

    const isFullSubmission = /<DOCUMENT>/i.test(text);
    const coverXml = isFullSubmission ? selectRegACoverDocument(text, form)?.body : text;
    if (coverXml === undefined) {
      throw new Error(`Form 1-K submission carries no <TYPE>${form} cover document`);
    }

    const parser = Form_1_K.getParser(Form1KSubmissionSchema);
    const json = parser.parse(coverXml) as Form1KSubmission;
    const cover = Value.Convert(Form1KSchema, json.edgarSubmission) as Form1K;

    // A report that carries no parseable statements is not a failure: a filing
    // may incorporate its financials by reference, or file them as a scanned
    // PDF. The cover data is still worth storing, so this degrades to an empty
    // list rather than throwing.
    const report = isFullSubmission ? selectRegAReportDocument(text, form) : undefined;
    const statements = report ? parseRegAFinancialStatements(report.body) : [];

    return { cover, statements };
  }
}
