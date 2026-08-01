/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_U5A extends Form {
  static readonly name = "Registration Notification";
  static readonly description =
    "Notification of registration filed under section 5(a) of the Public Utility Holding Company Act.";
  static readonly forms = ["U5A", "U5A/A"] as const;
}
