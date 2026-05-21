/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import Value from "typebox/value";
import { Form } from "../Form";
import { Form1A, Form1ASchema, Form1ASubmission, Form1ASubmissionSchema } from "./Form_1_A.schema";

export class Form_1_A extends Form {
  static readonly name = "Reg-A Offering Statement";
  static readonly description = "Reg-A Offering Statement";
  // "1-A POS" is a post-qualification amendment that reuses the Reg-A
  // edgarSubmission schema. The withdrawal variant 1-A-W is filed as HTML
  // only (no XML primary doc) and is intentionally excluded here.
  static readonly forms = ["1-A", "1-A/A", "1-A POS", "1", "1/A"] as const;

  static async parse(form: (typeof Form_1_A.forms)[number], xml: string): Promise<Form1A> {
    if (!Form_1_A.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    const parser = Form_1_A.getParser(Form1ASubmissionSchema);
    const json = parser.parse(xml) as Form1ASubmission;
    const rawForm1A = json.edgarSubmission;
    const form1A = Value.Convert(Form1ASchema, rawForm1A);
    return form1A as Form1A;
  }
}
