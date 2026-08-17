/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import { parseRegAFinancialStatements, type RegAStatement } from "./regAFinancialStatements";
import { selectRegAReportDocument } from "./regAReportDocument";

/**
 * A parsed Form 1-SA: the semiannual report's financial statements.
 *
 * There is no cover half here, unlike the 1-K. A 1-SA has NO XSD-tagged
 * primary document — every one of the 2,792 filings records a `.htm` primary
 * doc where every one of the 3,001 1-K filings records a `.xml` — so the report
 * document is the entire filing and the statements are all there is to extract.
 */
export interface ParsedForm1SA {
  readonly statements: readonly RegAStatement[];
}

export class Form_1_SA extends Form {
  static readonly name = "Semiannual Report (Regulation A)";
  static readonly description = "Semiannual report pursuant to Regulation A.";
  static readonly forms = ["1-SA", "1-SA/A"] as const;

  /**
   * Parses a 1-SA from its PRIMARY DOCUMENT — the report HTML itself.
   *
   * Unlike the 1-K, this form is NOT fetched as the full submission, because
   * there is nothing extra to get: every one of the 2,792 filings records a
   * `.htm` primary doc, and that document is the report. Escalating would
   * download a whole submission to arrive at the file already in hand, and would
   * invalidate a document cache that is already correct.
   *
   * A full submission is still accepted, and that is tolerance rather than the
   * path: `sec fetch form` and the bulk cache can both hand over a `.txt` (a
   * filing with no primary document at all falls back to one), and selecting by
   * `<TYPE>1-SA` reads the right document out of it.
   */
  static async parse(
    form: (typeof Form_1_SA.forms)[number],
    text: string
  ): Promise<ParsedForm1SA> {
    if (!Form_1_SA.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }

    const html = /<DOCUMENT>/i.test(text) ? selectRegAReportDocument(text, form)?.body : text;
    // No report document is not a failure — a filing may incorporate its
    // financials by reference, or file them as a scanned PDF the selector
    // refuses. An empty list lets the run record a clean success.
    if (html === undefined) return { statements: [] };

    return { statements: parseRegAFinancialStatements(html) };
  }
}
