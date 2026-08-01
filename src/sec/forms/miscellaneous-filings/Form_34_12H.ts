/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_34_12H extends Form {
  static readonly name = "Exchange Act Section 12(h) Exemption Application";
  static readonly description =
    "Application for an exemption from the registration and reporting provisions of the Exchange Act under Section 12(h), recorded against an 081- file number.";
  static readonly forms = ["34-12H"] as const;
}
