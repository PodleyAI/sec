/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_U_6B_2 extends Form {
  static readonly name = "Security Issue Certificate";
  static readonly description =
    "Certificate of notification of security issue, renewal or guaranty filed pursuant to Rule 20(d) of the Public Utility Holding Company Act.";
  static readonly forms = ["U-6B-2", "U-6B-2/A"] as const;
}
