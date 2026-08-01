/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_TACO extends Form {
  static readonly name = "Transfer Agent Cancellation Order";
  static readonly description =
    "Commission order under Section 17A(c)(4)(B) of the Exchange Act cancelling the registration of a transfer agent that has ceased to do business or ceased to exist. Entered by the SEC against the agent's 084- file number, typically in batches, not filed by the registrant.";
  static readonly forms = ["TACO"] as const;
}
