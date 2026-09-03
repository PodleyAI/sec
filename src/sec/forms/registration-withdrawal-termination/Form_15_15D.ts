/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_15_15D extends Form {
  static readonly name = "Section 13 and 15(d) Termination";
  static readonly description =
    "Certification of termination of registration of a class of security under Section 12(g) or notice of suspension of duty to file reports pursuant to Section 13 and 15(d) of the Securities Exchange Act. Section 13 and 15 (d) initial filing.";
  static readonly forms = ["15-15D", "15-15D/A"] as const;
}
