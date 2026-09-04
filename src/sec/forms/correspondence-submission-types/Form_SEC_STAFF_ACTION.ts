/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_SEC_STAFF_ACTION extends Form {
  static readonly name = "SEC Staff Action Notification";
  static readonly description = "Notification of SEC staff action.";
  static readonly forms = ["SEC STAFF ACTION"] as const;
}
