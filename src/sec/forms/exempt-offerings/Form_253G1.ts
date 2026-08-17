/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import { parseMetadataOnlyForm } from "../parseMetadataOnly";

export class Form_253G1 extends Form {
  static readonly name = "Offering Circular Supplement (Rule 253(g)(1))";
  static readonly description = "Supplement to a qualified Regulation A offering circular.";
  static readonly forms = ["253G1"] as const;
  // Metadata-only. The link to the offering (`024-…`) is in the submissions
  // payload for 100% of these filings and the rule subsection is the form name,
  // so the body — 1–2 MB of narrative HTML — is never fetched.
  static parse = parseMetadataOnlyForm;
}
