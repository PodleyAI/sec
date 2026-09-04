/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_D extends Form {
  static readonly name = "Notice of Sales of Unregistered Securities";
  static readonly description = "Notice of sales of unregistered securities";
  static readonly forms = ["D", "D/A"] as const;
}
