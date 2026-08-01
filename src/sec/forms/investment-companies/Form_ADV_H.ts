/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_ADV_H extends Form {
  static readonly name = "Investment Adviser Hardship Exemption (Form ADV-H)";
  static readonly description =
    "Application by an investment adviser for a hardship exemption from the electronic filing requirements of the Investment Advisers Act. ADV-H-T requests a temporary exemption; ADV-H-C requests a continuing exemption.";
  static readonly forms = ["ADV-H-T", "ADV-H-C"] as const;
}
