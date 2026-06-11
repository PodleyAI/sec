/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import Value from "typebox/value";
import { Form } from "../Form";
import {
  FormCfportal,
  FormCfportalSchema,
  FormCfportalSubmission,
  FormCfportalSubmissionSchema,
} from "./Form_CFPORTAL.schema";

export class Form_CFPORTAL extends Form {
  static readonly name = "Crowdfunding Portal Registration";
  static readonly description =
    "Registration, amendment, and withdrawal filings for crowdfunding portals.";
  // One EDGAR crowdfunding namespace covers registration, amendment, and
  // withdrawal; the withdrawal variant carries a stripped-down formData,
  // which Value.Convert tolerates because every section is optional.
  static readonly forms = ["CFPORTAL", "CFPORTAL/A", "CFPORTAL-W"] as const;

  static async parse(
    form: (typeof Form_CFPORTAL.forms)[number],
    xml: string
  ): Promise<FormCfportal> {
    if (!Form_CFPORTAL.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    const parser = Form_CFPORTAL.getParser(FormCfportalSubmissionSchema);
    const json = parser.parse(xml) as FormCfportalSubmission;
    const formCfportal = Value.Convert(FormCfportalSchema, json.edgarSubmission);
    return formCfportal as FormCfportal;
  }
}
