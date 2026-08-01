/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_40 extends Form {
  static readonly name = "Form 40";
  static readonly description = "Various forms under the Investment Company Act.";
  static readonly forms = [
    "40-APP",
    "40-APP/A",
    "40-6B",
    "40-6B/A",
    "40-6C",
    "40-6C/A",
    "40-F",
    "40-F/A",
    "40-33",
    "40-33/A",
    "40-24B2",
    "40-24B2/A",
    "40-17G",
    "40-17G/A",
    "40-17GCS",
    "40-17GCS/A",
    "4017GCS/A",
    "40-17F1",
    "40-17F1/A",
    "40-17F2",
    "40-17F2/A",
    // Section 8(f) deregistration applications on Form N-8F. The trailing
    // letter is the reason checked on the form: -A abandonment of
    // registration, -B election of status as a business development company,
    // -L liquidation, -M merger. All four were folded into plain N-8F.
    "40-8F-2",
    "40-8F-2/A",
    "40-8F-A",
    "40-8F-A/A",
    "40-8F-B",
    "40-8F-B/A",
    "40-8F-L",
    "40-8F-L/A",
    "40-8F-M",
    "40-8F-M/A",
    "40-8FC",
    "40-8FC/A",
    "40-8B25",
    "40-8B25/A",
  ] as const;
}
