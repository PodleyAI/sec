/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import { parseMetadataOnlyForm } from "../parseMetadataOnly";

export class Form_1_U extends Form {
  static readonly name = "Current Report (Regulation A)";
  static readonly description = "Current report pursuant to Regulation A.";
  static readonly forms = ["1-U", "1-U/A"] as const;
  // Metadata-only, like Form 25. The body is narrative HTML, but EDGAR reports
  // the item codes in the submissions payload for all 11,600 filings — so the
  // event and its date are known without reading it, and fetching them would
  // spend ~25 minutes of the shared 8 req/s budget to learn nothing new.
  static parse = parseMetadataOnlyForm;
}
