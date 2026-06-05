/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import {
  parseRegistrationSubmission,
  type FormS1Parsed,
} from "../registration-statements/s1/parseSubmission";

export class Form_F_1MEF extends Form {
  static readonly name = "F-1MEF";
  static readonly description = "Registration of additional securities for foreign private issuers";
  static readonly forms = ["F-1MEF"] as const;

  /** Reuse the shared registration-submission parser (header + primary document). */
  static override async parse(form: string, txt: string): Promise<FormS1Parsed> {
    return parseRegistrationSubmission(form, txt);
  }
}
