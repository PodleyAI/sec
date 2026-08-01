/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_ADN_MTL extends Form {
  static readonly name = "Additional Materials";
  static readonly description =
    "Additional materials furnished in support of a pending application for exemptive or other relief. Filed against the 812- application file number alongside APP WD / APP NTC / APP ORDR.";
  static readonly forms = ["ADN-MTL"] as const;
}
