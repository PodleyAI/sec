/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

/**
 * Undo of a Form RW. Catalogued so EDGAR's code is recognized, but not parsed
 * or extracted — reversing a withdrawal is not the same event as withdrawing.
 */
export class Form_RW_WD extends Form {
  static readonly name = "Withdrawal of Registration Withdrawal Request";
  static readonly description =
    "Withdraws a previously filed Form RW (undoes a registration withdrawal request).";
  static readonly forms = ["RW WD"] as const;
}
