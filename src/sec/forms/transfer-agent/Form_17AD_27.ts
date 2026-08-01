/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_17AD_27 extends Form {
  static readonly name = "Covered Matching Service Provider Annual Report (Rule 17Ad-27)";
  static readonly description =
    "Annual report of straight-through processing progress filed by a covered clearing agency that provides a central matching service, under Exchange Act Rule 17Ad-27. Filed against a 040- clearing-agency file number.";
  static readonly forms = ["17AD-27", "17AD-27/A"] as const;
}
