/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import Value from "typebox/value";
import { Form } from "../Form";
import {
  FormQualif,
  FormQualifSchema,
  FormQualifSubmission,
  FormQualifSubmissionSchema,
} from "./Form_QUALIF.schema";

export class Form_QUALIF extends Form {
  static readonly name = "Qualification of Offering Statement";
  static readonly description =
    "SEC notice qualifying a Regulation A offering statement — the authoritative qualification date.";
  static readonly forms = ["QUALIF"] as const;

  static async parse(form: (typeof Form_QUALIF.forms)[number], xml: string): Promise<FormQualif> {
    if (!Form_QUALIF.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    const parser = Form_QUALIF.getParser(FormQualifSubmissionSchema);
    const json = parser.parse(xml) as FormQualifSubmission;
    const raw = json.edgarSubmission;
    return Value.Convert(FormQualifSchema, raw) as FormQualif;
  }
}
