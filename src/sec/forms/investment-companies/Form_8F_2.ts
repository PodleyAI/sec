/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_8F_2 extends Form {
  static readonly name = "Rule 8f-2 Deregistration Notice and Order";
  static readonly description =
    "Commission notice and order on an application to deregister an investment company under Rule 8f-2 of the Investment Company Act. Entered against the fund's 811- file number; the underlying application is filed as N-8F.";
  static readonly forms = ["8F-2 NTC", "8F-2 ORDR"] as const;
}
