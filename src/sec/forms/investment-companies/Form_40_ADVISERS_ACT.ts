/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_40_ADVISERS_ACT extends Form {
  static readonly name = "Investment Advisers Act Exemptive Application";
  static readonly description =
    "Application for an exemptive order under the Investment Advisers Act, filed against an 803- file number. The trailing code is the statutory section invoked: 202A (definitions), 203A (state/SEC registration division), 205E (performance fee exemption) and 206A (general exemptive authority).";
  static readonly forms = [
    "40-202A",
    "40-202A/A",
    "40-203A",
    "40-203A/A",
    "40-205E",
    "40-205E/A",
    "40-206A",
    "40-206A/A",
  ] as const;
}
