/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import Value from "typebox/value";
import { Form } from "../Form";
import {
  Form144,
  Form144Schema,
  Form144Submission,
  Form144SubmissionSchema,
} from "./Form_144.schema";

export class Form_144 extends Form {
  static readonly name = "Notice of Proposed Sale of Securities";
  static readonly description =
    'Filed by "insiders" to give notice of a proposed sale of restricted or control securities under Rule 144. Filed electronically as XML since 2022.';
  static readonly forms = ["144", "144/A"] as const;

  static async parse(form: (typeof Form_144.forms)[number], xml: string): Promise<Form144> {
    if (!Form_144.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    const parser = Form_144.getParser(Form144SubmissionSchema);
    const json = parser.parse(xml) as Form144Submission;
    return Value.Convert(Form144Schema, json.edgarSubmission) as Form144;
  }
}
