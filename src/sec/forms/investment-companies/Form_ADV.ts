/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_ADV extends Form {
  static readonly name = "Investment Adviser Registration (Form ADV)";
  static readonly description =
    "Uniform application for investment adviser registration under the Investment Advisers Act, filed against the adviser's 801- file number. Only the paper-era amendment code appears in EDGAR; current Form ADV filings are made through IARD rather than EDGAR.";
  static readonly forms = ["ADV/A"] as const;
}
