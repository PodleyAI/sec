/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import Value from "typebox/value";
import { Form } from "../Form";
import { FormC, FormCSchema, FormCSubmission, FormCSubmissionSchema } from "./Form_C.schema";

export class Form_C extends Form {
  static readonly name = "Offering Statement (Regulation Crowdfunding)";
  static readonly description = "Offering Statement (Regulation Crowdfunding)";
  // All Form C submission types share the EDGAR formc namespace: the
  // post-offering forms (C-U progress update, C-AR annual report, C-TR
  // termination) and every amendment/withdrawal variant carry the same
  // edgarSubmission structure with different optional sections populated.
  // Value.Convert is lenient about missing optional fields, so one parse
  // path handles every variant.
  static readonly forms = [
    "C",
    "C/A",
    "C-W",
    "C/A-W",
    "C-U",
    "C-U-W",
    "C-AR",
    "C-AR/A",
    "C-AR-W",
    "C-AR/A-W",
    "C-TR",
    "C-TR-W",
  ] as const;

  static async parse(form: (typeof Form_C.forms)[number], xml: string): Promise<FormC> {
    if (!Form_C.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    const parser = Form_C.getParser(FormCSubmissionSchema);
    const json = parser.parse(xml) as FormCSubmission;
    const rawFormC = json.edgarSubmission;
    const formC = Value.Convert(FormCSchema, rawFormC);
    return formC as FormC;
  }
}
