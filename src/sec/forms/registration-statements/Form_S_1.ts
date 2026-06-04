/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import { parseRegistrationSubmission, type FormS1Parsed } from "./s1/parseSubmission";

export type { FormS1Parsed, FormS1Header } from "./s1/parseSubmission";

export class Form_S_1 extends Form {
  static readonly name = "Registration Statement (S-1)";
  static readonly description = "Initial registration statement for new securities.";
  static readonly forms = ["S-1", "S-1/A", "S-1MEF"] as const;

  static override async parse(form: string, txt: string): Promise<FormS1Parsed> {
    return parseRegistrationSubmission(form, txt);
  }
}
