/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_10_M extends Form {
  static readonly name = "Form 10-M";
  static readonly description =
    "Legacy paper submission type recorded against a broker-dealer 008- file number under the Exchange Act. Only a single filing exists (2022); EDGAR publishes no description for the code and the underlying document is a paper-submission placeholder, so the precise form is unconfirmed.";
  static readonly forms = ["10-M"] as const;
}
