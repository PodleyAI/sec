/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_CFPORTAL extends Form {
  static readonly name = "Crowdfunding Portal Registration";
  static readonly description =
    "Registration, amendment, and withdrawal filings for crowdfunding portals.";
  // One EDGAR crowdfunding namespace covers registration, amendment, and
  // withdrawal; the withdrawal variant carries a stripped-down formData,
  // which Value.Convert tolerates because every section is optional.
  static readonly forms = ["CFPORTAL", "CFPORTAL/A", "CFPORTAL-W"] as const;
}
