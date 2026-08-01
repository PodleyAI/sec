/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_N_CEN extends Form {
  static readonly name = "Annual Report";
  static readonly description = "Annual Report for Registered Investment Companies";
  // EDGAR emits the late-filing notification under both a spaced and a
  // hyphenated code ("NT N-CEN" and "NT-NCEN") plus the legacy "NTFNCEN".
  static readonly forms = [
    "N-CEN",
    "N-CEN/A",
    "NT N-CEN",
    "NT N-CEN/A",
    "NT-NCEN",
    "NT-NCEN/A",
    "NTFNCEN",
  ] as const;
}
