/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_424I extends Form {
  static readonly name = "Prospectus (424I)";
  static readonly description =
    "Prospectus filed under Securities Act Rule 424(i) by an issuer conducting a continuous offering, used almost entirely by commodity and currency exchange-traded trusts.";
  static readonly forms = ["424I"] as const;
}
