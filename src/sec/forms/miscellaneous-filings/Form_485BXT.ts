/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_485BXT extends Form {
  static readonly name = "Post-Effective Amendment to Registration Statement";
  static readonly description =
    "Post-effective amendment to registration statement filed pursuant to Rule 485(b) under the Securities Act of 1933";
  // "485BXTF" is the legacy code for the same Rule 485(b) delaying amendment.
  static readonly forms = ["485BXT", "485BXTF"] as const;
}
