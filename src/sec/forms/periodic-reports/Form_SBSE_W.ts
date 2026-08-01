/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_SBSE_W extends Form {
  static readonly name = "Security-Based Swap Entity Withdrawal (Form SBSE-W)";
  static readonly description =
    "Notice of withdrawal from registration as a security-based swap dealer or major security-based swap participant.";
  static readonly forms = ["SBSE-W"] as const;
}
