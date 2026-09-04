/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_15F_12G extends Form {
  static readonly name = "Foreign Private Issuer Section 12(g) Termination";
  static readonly description =
    "Notice of termination of a foreign private issuer's registration of a class of securities under Section 12(g).";
  static readonly forms = ["15F-12G", "15F-12G/A"] as const;
}
