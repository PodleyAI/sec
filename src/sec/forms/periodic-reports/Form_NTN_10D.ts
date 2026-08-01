/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_NTN_10D extends Form {
  static readonly name = "Rule 12b-25 Notification for 10-D";
  static readonly description =
    "Notice under Rule 12b-25 of inability to timely file all or part of a Form 10-D.";
  static readonly forms = ["NTN 10D"] as const;
}
