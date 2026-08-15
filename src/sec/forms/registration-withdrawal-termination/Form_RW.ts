/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import { parseMetadataOnlyForm } from "../parseMetadataOnly";

export class Form_RW extends Form {
  static readonly name = "Registration Withdrawal Request";
  static readonly description =
    "Request for a withdrawal of a previously filed registration statement.";
  static readonly forms = ["RW"] as const;
  static parse = parseMetadataOnlyForm;
}
