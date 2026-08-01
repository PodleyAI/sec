/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_WDL_REQ extends Form {
  static readonly name = "Withdrawal Request";
  static readonly description =
    "Request to withdraw a Regulation A offering statement, filed on paper against the issuer's 024- file number. The electronic equivalents are 1-A-W and 1-Z-W.";
  static readonly forms = ["WDL-REQ"] as const;
}
