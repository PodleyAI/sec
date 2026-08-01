/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_UNDER extends Form {
  static readonly name = "Supplemental Undertaking";
  static readonly description =
    "Supplemental undertaking submitted in support of a pending registration statement, most often by a closed-end fund registering on Form N-2 and accompanying a request to accelerate the effective date.";
  static readonly forms = ["UNDER", "UNDER/A"] as const;
}
