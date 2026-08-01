/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_F_9EF extends Form {
  static readonly name = "MJDS Registration Effective on Filing (Form F-9EF)";
  static readonly description =
    "Registration statement on Form F-9 by a Canadian issuer that becomes effective automatically upon filing under Securities Act Rule 467(a).";
  static readonly forms = ["F-9EF"] as const;
}
