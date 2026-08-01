/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_MA extends Form {
  static readonly name = "Municipal Advisor Registration";
  static readonly description =
    "Application for municipal advisor registration under Section 15B(a)(1) of the Exchange Act.";
  // MA-W is the registrant's own withdrawal; CANCELLATION-MA and
  // REVOCATION-MA are Commission actions against the 867- file number.
  static readonly forms = ["MA", "MA/A", "MA-W", "CANCELLATION-MA", "REVOCATION-MA"] as const;
}
