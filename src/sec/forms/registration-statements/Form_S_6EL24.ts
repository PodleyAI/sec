/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_S_6EL24 extends Form {
  static readonly name = "Registration Statement (S-6EL24)";
  static readonly description =
    "Registration statements of unit investment trusts with 24f-2 election.";
  static readonly forms = ["S-6EL24", "S-6EL24/A"] as const;
}
