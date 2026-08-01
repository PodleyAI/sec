/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_SEC_ACTION extends Form {
  static readonly name = "SEC Action";
  static readonly description =
    "Commission action recorded against a registrant's file number. Distinct from the longer-standing SEC STAFF ACTION code; SEC ACTION appears from 2019 onward, largely on security-based swap entity (026-) file numbers.";
  static readonly forms = ["SEC ACTION"] as const;
}
