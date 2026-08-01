/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_N_8B_4 extends Form {
  static readonly name = "Face-Amount Certificate Company Registration (Form N-8B-4)";
  static readonly description =
    "Registration statement of a face-amount certificate company under Section 8(b) of the Investment Company Act.";
  static readonly forms = ["N-8B-4", "N-8B-4/A"] as const;
}
