/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_20F extends Form {
  static readonly name = "Annual/Transition Report for Foreign Private Issuers";
  static readonly description =
    "Annual and transition report of foreign private issuers filed pursuant to sections 13 or 15(d) of the Securities Exchange Act.";
  static readonly forms = ["20-F", "20-F/A"] as const;
}
