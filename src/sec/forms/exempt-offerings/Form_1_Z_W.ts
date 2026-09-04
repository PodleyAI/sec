/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_1_Z_W extends Form {
  static readonly name = "Withdrawal of Exit Report (Regulation A)";
  static readonly description = "Withdrawal of exit report under Regulation A.";
  static readonly forms = ["1-Z-W", "1-Z-W/A"] as const;
  // Metadata-only: a withdrawal asserts nothing beyond its own date and the
  // offering it withdraws, both of which arrive as filings metadata.
}
