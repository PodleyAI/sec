/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_G_FINW extends Form {
  static readonly name = "Government Securities Registration Withdrawal (Form G-FINW)";
  static readonly description =
    "Notice by a financial institution withdrawing from its status as a government securities broker or dealer under Section 15C of the Exchange Act, closing out the registration opened by Form G-FIN.";
  static readonly forms = ["G-FINW"] as const;
}
