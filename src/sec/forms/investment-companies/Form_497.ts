/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_497 extends Form {
  static readonly name = "Definitive Materials";
  static readonly description = "Definitive materials filed by investment companies";
  static readonly forms = [
    "497",
    "497/A",
    "497AD",
    "497AD/A",
    "497J",
    "497J/A",
    "497K",
    "497K/A",
    // Legacy fund "profile" filings under Rule 497(k); 497K1/K2/K3A/K3B are
    // the retired variants that predate the summary prospectus (497K).
    "497K1",
    "497K1/A",
    "497K2",
    "497K3A",
    "497K3B",
    "497VPI",
    "497VPI/A",
    "497VPSUB",
    "497VPSUB/A",
    "497VPU",
    "497VPU/A",
    "497H2",
    "497H2/A",
  ] as const;
}
