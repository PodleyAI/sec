/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_N_23C_3 extends Form {
  static readonly name = "Notification of Repurchase Offer (Rule 23c-3 ICA 1940)";
  static readonly description =
    "Notification of repurchase offer pursuant to Rule 23c-3 of the Investment Company Act of 1940.";
  static readonly forms = [
    "N-23C-3",
    "N-23C-3/A",
    "N-23C-3A",
    "N-23C-3A/A",
    "N-23C-3B",
    "N-23C-3B/A",
    "N-23C3A",
    "N-23C3A/A",
    "N-23C3B",
    "N-23C3B/A",
    // "C" marks a discretionary repurchase offer under Rule 23c-3(c).
    "N-23C3C",
    "N-23C3C/A",
    "N-23C-3C",
    "N-23C-3C/A",
  ] as const;
}
