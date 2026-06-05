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

export class Form_F_1 extends Form {
  static readonly name = "F-1";
  static readonly description = "Registration statement for foreign private issuers";
  static readonly forms = ["F-1", "F-1/A"] as const;

  /** F-1 / F-1/A are the foreign-issuer S-1; reuse the shared submission parser. */
  static override async parse(form: string, txt: string): Promise<FormS1Parsed> {
    return parseRegistrationSubmission(form, txt);
  }
}
