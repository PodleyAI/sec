/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_19B_4 extends Form {
  static readonly name = "SRO Proposed Rule Change (Form 19b-4)";
  static readonly description =
    "Filing by a self-regulatory organization under Section 19(b) of the Exchange Act. 19B-4E is the Rule 19b-4(e) notice an exchange files when it lists and trades a new derivative securities product under existing generic listing standards, and is by far the more common of the two.";
  static readonly forms = ["19B-4", "19B-4E"] as const;
}
