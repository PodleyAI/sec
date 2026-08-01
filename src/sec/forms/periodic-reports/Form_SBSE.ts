/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_SBSE extends Form {
  static readonly name = "Security-Based Swap Entity Registration (Form SBSE)";
  static readonly description =
    "Application for registration as a security-based swap dealer or major security-based swap participant, filed against a 026- file number. Note that SBSE/A (an amendment to Form SBSE) and SBSE-A (the separate application form for entities registered with the CFTC) are distinct EDGAR codes.";
  static readonly forms = ["SBSE", "SBSE/A"] as const;
}
