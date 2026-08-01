/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_26 extends Form {
  static readonly name = "Form 26";
  static readonly description =
    "Legacy paper submission type recorded against an Exchange Act 001- file number. A single 2002 filing exists, EDGAR publishes no description for the code, and the dissemination record is a paper-submission placeholder, so the precise form is unconfirmed; the adjacent Form 25 (notification of removal from listing) is the most likely intent.";
  static readonly forms = ["26"] as const;
}
