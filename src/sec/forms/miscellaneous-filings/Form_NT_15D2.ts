/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_NT_15D2 extends Form {
  static readonly name = "Form NT 15D2";
  static readonly description =
    "Notification of late filing Special report pursuant to section 15d-2.";
  // "NTN15D2" is the unspaced code EDGAR recorded for the same notification.
  static readonly forms = ["NT 15D2", "NT 15D2/A", "NTN15D2"] as const;
}
