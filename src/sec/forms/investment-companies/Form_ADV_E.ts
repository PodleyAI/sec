/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_ADV_E extends Form {
  static readonly name = "Investment Adviser Custody Accountant Certificate (Form ADV-E)";
  static readonly description =
    "Certificate of accounting of securities and funds in the possession or custody of an investment adviser, filed by the independent public accountant that performed the surprise examination. Filed under the Investment Advisers Act against the adviser's 801- file number.";
  static readonly forms = ["ADV-E"] as const;
}
