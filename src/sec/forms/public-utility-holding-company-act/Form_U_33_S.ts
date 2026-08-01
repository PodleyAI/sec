/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_U_33_S extends Form {
  static readonly name = "Foreign Utility Companies Annual Report";
  static readonly description =
    "Annual report concerning Foreign Utility Companies pursuant to section 33(e) of the Public Utility Holding Company Act.";
  static readonly forms = ["U-33-S", "U-33-S/A"] as const;
}
