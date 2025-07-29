/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Value } from "@sinclair/typebox/value";
import { Form } from "../Form";
import { Form1K, Form1KSchema, Form1KSubmission, Form1KSubmissionSchema } from "./Form_1_K.schema";

export class Form_1_K extends Form {
  static readonly name = "Annual Report (Regulation A)";
  static readonly description = "Annual report pursuant to Regulation A.";
  static readonly forms = ["1-K", "1-K/A"] as const;

  static async parse(form: (typeof Form_1_K.forms)[number], xml: string): Promise<Form1K> {
    if (!Form_1_K.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    const parser = Form_1_K.getParser(Form1KSubmissionSchema);
    const json = parser.parse(xml) as Form1KSubmission;
    const rawForm1K = json.edgarSubmission;
    const form1K = Value.Convert(Form1KSchema, rawForm1K);
    return form1K as Form1K;
  }
}
