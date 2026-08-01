/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_NRSRO_CE extends Form {
  static readonly name = "NRSRO Annual Certification";
  static readonly description =
    "Annual certification filed by a Nationally Recognized Statistical Rating Organization under Exchange Act Section 15E(b)(2), filed against the agency's 110- file number.";
  static readonly forms = ["NRSRO-CE", "NRSRO-CE/A"] as const;
}
