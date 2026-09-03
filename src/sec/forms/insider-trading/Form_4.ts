/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_4 extends Form {
  static readonly name = "Statement of Changes in Beneficial Ownership";
  static readonly description =
    "Any changes to a previously filed form 3 are reported in this filing.";
  static readonly forms = ["4", "4/A"] as const;
}
