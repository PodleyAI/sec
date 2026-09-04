/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_25 extends Form {
  static readonly name = "Voluntary Withdrawal of Securities (Form 25)";
  static readonly description =
    "Notification filed by issuer to voluntarily withdraw a class of securities from listing and registration on a national securities exchange.";
  static readonly forms = ["25", "25/A"] as const;
}
