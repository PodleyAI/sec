/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_N_CSR extends Form {
  static readonly name = "Certified Annual Shareholder Report";
  static readonly description =
    "Certified annual shareholder report of registered management investment companies filed on Form N-CSR.";
  static readonly forms = ["N-CSR", "N-CSR/A", "NT-NCSR", "NT-NCSR/A", "NTFNCSR"] as const;
}
