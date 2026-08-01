/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_F_80 extends Form {
  static readonly name = "MJDS Exchange Offer Registration (Form F-80)";
  static readonly description =
    "Registration statement under the Securities Act for securities of certain Canadian issuers offered in an exchange offer or business combination, filed under the multijurisdictional disclosure system. F-80POS is a post-effective amendment.";
  static readonly forms = ["F-80", "F-80/A", "F-80POS"] as const;
}
