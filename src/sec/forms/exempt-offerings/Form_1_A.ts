/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_1_A extends Form {
  static readonly name = "Reg-A Offering Statement";
  static readonly description = "Reg-A Offering Statement";
  // "1-A POS" is a post-qualification amendment that reuses the Reg-A
  // edgarSubmission schema. The withdrawal variant 1-A-W is filed as HTML
  // only (no XML primary doc) and is intentionally excluded here. EDGAR
  // form "1" (application for registration as a national securities
  // exchange) is unrelated to Reg A and must not be claimed here.
  static readonly forms = ["1-A", "1-A/A", "1-A POS"] as const;
}
