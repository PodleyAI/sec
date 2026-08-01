/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_ID_NEWCIK extends Form {
  static readonly name = "New CIK Identification";
  static readonly description =
    "EDGAR filer-identification submission establishing a new Central Index Key. Administrative rather than a disclosure form; the dissemination record carries a private-to-public marker and a cover letter.";
  static readonly forms = ["ID-NEWCIK"] as const;
}
