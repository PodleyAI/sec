/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_PRE_14C extends Form {
  static readonly name = "Preliminary Information Statement";
  static readonly description = "A preliminary proxy statement containing all other information.";
  // "PREA14C" is an unspaced variant EDGAR recorded once.
  static readonly forms = ["PRE 14C", "PREA14C"] as const;
}
