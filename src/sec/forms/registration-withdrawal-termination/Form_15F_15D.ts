/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_15F_15D extends Form {
  static readonly name = "Foreign Private Issuer Section 13 and 15(d) Termination";
  static readonly description =
    "Notice of a foreign private issuer's suspension of duty to file reports pursuant to Section 13 and 15(d) of the Act.";
  static readonly forms = ["15F-15D", "15F-15D/A"] as const;
}
