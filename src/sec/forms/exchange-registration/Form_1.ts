/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_1 extends Form {
  static readonly name = "National Securities Exchange Registration Application";
  static readonly description =
    "Application by an exchange to register as a national securities exchange, or to be exempted from registration based on limited volume, under Section 6 of the Exchange Act. Filed against a 010- file number. Unrelated to the Reg-A form 1-A.";
  static readonly forms = ["1", "1/A"] as const;
}
