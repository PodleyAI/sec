/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_ADVCO extends Form {
  static readonly name = "Investment Adviser Cancellation Order";
  static readonly description =
    "Commission order cancelling the registration of an investment adviser, entered against the adviser's 801- file number rather than filed by the registrant. The broker-dealer and transfer-agent analogues are BDCO and TACO.";
  static readonly forms = ["ADVCO"] as const;
}
