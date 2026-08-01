/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_12G3_2B extends Form {
  static readonly name = "Form 12G3-2B";
  static readonly description =
    "Annual and transition reports of foreign private issuers pursuant to section 13 or 15(d) of the Securities Exchange Act.";
  // "12G32BR" is the unpunctuated code EDGAR uses for the paper submissions
  // furnished under the same Rule 12g3-2(b) exemption (082- file numbers).
  static readonly forms = ["12G3-2B", "12G32BR"] as const;
}
