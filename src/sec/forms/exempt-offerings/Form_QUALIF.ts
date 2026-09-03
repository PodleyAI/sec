/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_QUALIF extends Form {
  static readonly name = "Qualification of Offering Statement";
  static readonly description =
    "SEC notice qualifying a Regulation A offering statement — the authoritative qualification date.";
  static readonly forms = ["QUALIF"] as const;
}
