/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_SDR extends Form {
  static readonly name = "Security-Based Swap Data Repository Registration (Form SDR)";
  static readonly description =
    "Application for registration as a security-based swap data repository under Section 13(n) of the Exchange Act, filed against a 040- file number.";
  static readonly forms = ["SDR", "SDR/A"] as const;
}
