/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_1_Z extends Form {
  static readonly name = "Exit Report (Regulation A)";
  static readonly description = "Exit report pursuant to Regulation A.";
  static readonly forms = ["1-Z", "1-Z/A"] as const;
}
