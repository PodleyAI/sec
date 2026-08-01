/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_T_6 extends Form {
  static readonly name = "Foreign Corporate Trustee Eligibility (Form T-6)";
  static readonly description =
    "Statement of eligibility and qualification of a foreign corporation to act as sole trustee under an indenture qualified under the Trust Indenture Act of 1939.";
  static readonly forms = ["T-6", "T-6/A"] as const;
}
