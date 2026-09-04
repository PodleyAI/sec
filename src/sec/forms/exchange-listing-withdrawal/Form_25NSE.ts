/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_25NSE extends Form {
  static readonly name = "Exchange Notification of Securities Removal (Form 25-NSE)";
  static readonly description =
    "Notification filed by a national securities exchange to remove matured, redeemed, or retired securities from listing.";
  static readonly forms = ["25-NSE", "25-NSE/A"] as const;
}
