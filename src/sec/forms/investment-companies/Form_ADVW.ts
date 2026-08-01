/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_ADVW extends Form {
  static readonly name = "Investment Adviser Registration Withdrawal (Form ADV-W)";
  static readonly description =
    "Notice of withdrawal from registration as an investment adviser, filed against the adviser's 801- file number.";
  static readonly forms = ["ADVW"] as const;
}
