/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_BDCO extends Form {
  static readonly name = "Broker-Dealer Cancellation Order";
  static readonly description =
    "Commission order cancelling the registration of a broker-dealer that has ceased to do business or ceased to exist. Entered by the SEC against the firm's 008- file number, typically in batches, not filed by the registrant. The transfer-agent analogue is TACO.";
  static readonly forms = ["BDCO"] as const;
}
