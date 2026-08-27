/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

/**
 * Form 1-SA — the Regulation A semiannual report.
 *
 * Catalogued here but not extracted. A 1-SA is nothing BUT its financial
 * statements: there is no XSD-tagged cover page — every one of the 2,792 filings
 * records a `.htm` primary doc where every one of the 3,001 1-K filings records
 * a `.xml` — so the report document is the entire filing and reading it means
 * scanning human-authored HTML tables. That scan is not part of this package,
 * and neither is any extractor over this form.
 *
 * The catalogue entry stays because it is what the dispatcher resolves a form to
 * before running whatever extractors are registered over it, and an extractor
 * registered downstream still needs the form to resolve. That extractor supplies
 * its own reading of the document.
 *
 * Unlike the 1-K, this form is deliberately NOT fetched as the full submission —
 * see `submissionFetchKind`. Its primary document IS its report, so escalating
 * would download a whole submission to arrive at the file already in hand.
 */
export class Form_1_SA extends Form {
  static readonly name = "Semiannual Report (Regulation A)";
  static readonly description = "Semiannual report pursuant to Regulation A.";
  static readonly forms = ["1-SA", "1-SA/A"] as const;

  /**
   * Reads nothing. sec has no reading of a 1-SA to share, and an empty object
   * rather than a throw is what keeps a filing dispatched to a downstream
   * extractor a clean run instead of a `PARSE_ERROR` dead letter.
   */
  static async parse(_form: string, _text: string): Promise<Record<string, never>> {
    return {};
  }
}
