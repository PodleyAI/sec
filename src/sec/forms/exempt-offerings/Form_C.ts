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
  static readonly forms = ["C", "C-W", "C/A", "C/A-W"] as const;

  static async parse(form: (typeof Form_C.forms)[number], xml: string): Promise<FormC> {
    if (!Form_C.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    // C, C/A, C-W, C/A-W all share the same EDGAR formc namespace. Withdrawal
    // variants carry a stripped-down formData (issuer name + signatures only)
    // but Value.Convert is lenient about missing optional fields, so one
    // parse path handles every variant.
    const parser = Form_C.getParser(FormCSubmissionSchema);
    const json = parser.parse(xml) as FormCSubmission;
    const rawFormC = json.edgarSubmission;
    const formC = Value.Convert(FormCSchema, rawFormC);
    return formC as FormC;
  }
}
