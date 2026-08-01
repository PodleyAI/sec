/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_SPDSCL extends Form {
  static readonly name = "Special Disclosure (HFCAA)";
  static readonly description =
    "Special disclosure submitted under the Holding Foreign Companies Accountable Act by an issuer identified as using an audit firm the PCAOB cannot inspect. EDGAR tags the submission with an HFCAA-GOV category and document type covering governmental ownership and control.";
  static readonly forms = ["SPDSCL"] as const;
}
