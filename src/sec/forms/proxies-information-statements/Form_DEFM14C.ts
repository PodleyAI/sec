/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import { parseRegistrationSubmission } from "../registration-statements/s1/parseSubmission";
import type { FormS1Parsed } from "../registration-statements/Form_S_1";

export class Form_DEFM14C extends Form {
  static readonly name = "Definitive Information Statement for Merger or Acquisition";
  static readonly description =
    "A definitive information statement relating to a merger or an acquisition.";
  static readonly forms = ["DEFM14C"] as const;

  static override async parse(form: string, txt: string): Promise<FormS1Parsed> {
    return parseRegistrationSubmission(form, txt);
  }
}
