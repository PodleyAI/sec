/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_DEF_OC extends Form {
  static readonly name = "Definitive Offering Circular";
  static readonly description =
    "Definitive offering circular for a Regulation A offering, filed on paper against the issuer's 024- offering-statement file number.";
  static readonly forms = ["DEF-OC"] as const;
}
