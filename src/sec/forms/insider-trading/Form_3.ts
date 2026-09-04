/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_3 extends Form {
  static readonly name = "Initial Statement of Beneficial Ownership";
  static readonly description =
    "An initial filing of equity securities filed by every director, officer, or owner of more than ten percent of a class of equity securities.";
  static readonly forms = ["3", "3/A"] as const;
}
