/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import type { FormS1Parsed } from "../registration-statements/Form_S_1";
import { parseRegistrationSubmission } from "../registration-statements/s1/parseSubmission";

export class Form_PREM14C extends Form {
  static readonly name = "Preliminary Information Statement for Merger or Acquisition";
  static readonly description =
    "A preliminary information statement relating to a merger or acquisition.";
  static readonly forms = ["PREM14C"] as const;

  static override async parse(form: string, txt: string): Promise<FormS1Parsed> {
    return parseRegistrationSubmission(form, txt);
  }
}
