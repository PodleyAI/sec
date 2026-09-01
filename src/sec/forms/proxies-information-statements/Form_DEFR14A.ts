/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import type { FormS1Parsed } from "../registration-statements/Form_S_1";
import { parseRegistrationSubmission } from "../registration-statements/s1/parseSubmission";

export class Form_DEFR14A extends Form {
  static readonly name = "Definitive Revised Proxy Soliciting Materials";
  static readonly description =
    "Definitive revised proxy soliciting materials filed pursuant to Section 14(a) of the Securities Exchange Act of 1934";
  static readonly forms = ["DEFR14A"] as const;

  static override async parse(form: string, txt: string): Promise<FormS1Parsed> {
    return parseRegistrationSubmission(form, txt);
  }
}
