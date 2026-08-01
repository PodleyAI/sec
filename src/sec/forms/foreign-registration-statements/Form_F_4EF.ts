/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_F_4EF extends Form {
  static readonly name =
    "Foreign Business Combination Registration Effective on Filing (Form F-4EF)";
  static readonly description =
    "Registration statement on Form F-4 for a foreign private issuer that becomes effective automatically upon filing.";
  static readonly forms = ["F-4EF"] as const;
}
