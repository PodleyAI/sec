/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import { parseRegistrationSubmission, type FormS1Parsed } from "./s1/parseSubmission";

export class Form_424 extends Form {
  static readonly name = "Prospectus (424)";
  static readonly description =
    "Contains substantive changes from or additions to a prospectus previously filed with the SEC as part of the registration statement.";
  static readonly forms = ["424A", "424B1", "424B2", "424B3", "424B4", "424B5", "424B7"] as const;

  static override async parse(form: string, txt: string): Promise<FormS1Parsed> {
    return parseRegistrationSubmission(form, txt);
  }
}
