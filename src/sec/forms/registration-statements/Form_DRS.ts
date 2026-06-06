/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import { parseRegistrationSubmission, type FormS1Parsed } from "./s1/parseSubmission";

export class Form_DRS extends Form {
  static readonly name = "Draft Registration Statement (DRS)";
  static readonly description =
    "Confidential draft registration statement (JOBS Act); a draft S-1 with identical structure.";
  static readonly forms = ["DRS", "DRS/A"] as const;

  static override async parse(form: string, txt: string): Promise<FormS1Parsed> {
    return parseRegistrationSubmission(form, txt);
  }
}
