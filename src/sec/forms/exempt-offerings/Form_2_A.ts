/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_2_A extends Form {
  static readonly name = "Reg-A Report of Sales and Uses of Proceeds";
  static readonly description =
    "Periodic report of sales of securities and use of proceeds under Regulation A, filed against the issuer's 024- offering-statement file number. Not to be confused with 2-E, the Regulation E analogue.";
  static readonly forms = ["2-A", "2-A/A"] as const;
}
