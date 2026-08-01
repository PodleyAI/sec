/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_10QSB extends Form {
  static readonly name = "Small Business Quarterly Report";
  static readonly description =
    "A quarterly report which provides a continuing view of a company's financial position during the year. The 10QSB form is filed by small businesses.";
  // "10-QSB" is a rare misfiled spelling (a handful of 2001-2002 filings);
  // EDGAR's canonical code is the unhyphenated "10QSB".
  static readonly forms = ["10QSB", "10QSB/A", "10-QSB", "10-QSB/A"] as const;
}
