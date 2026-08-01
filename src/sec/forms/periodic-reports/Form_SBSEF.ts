/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_SBSEF extends Form {
  static readonly name = "Security-Based Swap Execution Facility Registration (Form SBSEF)";
  static readonly description =
    "Application for registration as a security-based swap execution facility under Section 3D of the Exchange Act, filed against a 039- file number. SBSEF-W withdraws the registration.";
  static readonly forms = ["SBSEF", "SBSEF/A", "SBSEF-W"] as const;
}
