/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import Value from "typebox/value";
import { Form } from "../Form";
import { Form1K, Form1KSchema, Form1KSubmission, Form1KSubmissionSchema } from "./Form_1_K.schema";
import { selectRegACoverDocument } from "./regAReportDocument";

/**
 * A parsed Form 1-K: the XSD cover page.
 *
 * The cover is `primary_doc.xml`, and its XSD has no financial elements at all.
 * The annual report itself lives beside it in the submission as
 * `<TYPE>PART II` — reading it is scanning human-authored HTML tables, which
 * this package does not do, so what a 1-K parses to here is the cover and
 * nothing else. `selectRegAReportDocument` still resolves that report document
 * for whatever reads it.
 */
export interface ParsedForm1K {
  readonly cover: Form1K;
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
   * escalated) still parses. The two are told apart by looking for the SGML
   * `<DOCUMENT>` envelope rather than by trusting the caller, because both
   * arrive as a string and getting it wrong is silent.
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

    return { cover };
  }
}
