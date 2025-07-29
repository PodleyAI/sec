/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Value } from "@sinclair/typebox/value";
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
    if (form === "C" || form === "C/A") {
      const parser = Form_C.getParser(FormCSubmissionSchema);
      const json = parser.parse(xml) as FormCSubmission;
      const rawFormC = json.edgarSubmission;
      const formC = Value.Convert(FormCSchema, rawFormC);
      return formC as FormC;
    }
    throw new Error(`Invalid form: ${form} [not implemented]`);
  }
}
