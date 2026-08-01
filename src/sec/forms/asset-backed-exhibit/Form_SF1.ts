/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_SF1 extends Form {
  static readonly name = "Registration Statement for Asset-Backed Securities (SF-1)";
  static readonly description =
    "Registration statement for asset-backed securities under the Securities Act of 1933.";
  // EDGAR indexes the Rule 462(b) companion registration as "SF-1MEF";
  // "SF-1MEP" is the misfiled spelling.
  static readonly forms = ["SF-1", "SF-1/A", "SF-1MEF", "SF-1MEP"] as const;
}
