/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Value } from "@sinclair/typebox/value";
import { Form } from "../Form";
import { Form1Z, Form1ZSchema, Form1ZSubmission, Form1ZSubmissionSchema } from "./Form_1_Z.schema";

export class Form_1_Z extends Form {
  static readonly name = "Exit Report (Regulation A)";
  static readonly description = "Exit report pursuant to Regulation A.";
  static readonly forms = ["1-Z", "1-Z/A"] as const;

  static async parse(form: (typeof Form_1_Z.forms)[number], xml: string): Promise<Form1Z> {
    if (!Form_1_Z.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    const parser = Form_1_Z.getParser(Form1ZSubmissionSchema);
    const json = parser.parse(xml) as Form1ZSubmission;
    const rawForm1Z = json.edgarSubmission;
    const form1Z = Value.Convert(Form1ZSchema, rawForm1Z);
    return form1Z as Form1Z;
  }
}
