/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_10KSB extends Form {
  static readonly name = "Annual Report for Small Businesses";
  static readonly description =
    "An annual report which provides a comprehensive overview of the company for the past year. The 10KSB is filed by small businesses.";
  // "10-KSB" is a rare misfiled spelling (a handful of 2001-2002 filings);
  // EDGAR's canonical code is the unhyphenated "10KSB".
  static readonly forms = ["10KSB", "10KSB/A", "10-KSB", "10-KSB/A"] as const;
}
