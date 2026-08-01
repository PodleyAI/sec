/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_486B24E extends Form {
  static readonly name = "Post-Effective Amendment to Registration Statement";
  static readonly description =
    "Post-effective amendment filed under Securities Act Rule 486(b) together with a Rule 24e-2 election under the Investment Company Act of 1940.";
  static readonly forms = ["486B24E"] as const;
}
