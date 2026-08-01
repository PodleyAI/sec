/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_40_RPT extends Form {
  static readonly name = "Report Under Investment Company Act Exemptive Order";
  static readonly description =
    "Periodic report filed pursuant to a condition of an exemptive order granted under the Investment Company Act. Recorded against the 812- application file number that produced the order.";
  static readonly forms = ["40-RPT"] as const;
}
