/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import { parseRegistrationSubmission } from "../registration-statements/s1/parseSubmission";
import type { FormS1Parsed } from "../registration-statements/Form_S_1";

export class Form_DEF_14A extends Form {
  static readonly name = "Definitive Proxy Statement";
  static readonly description =
    'Provides official notification to designated classes of shareholders of matters to be brought to a vote at a shareholders meeting. This form is commonly referred to as a "Proxy".';
  static readonly forms = ["DEF 14A"] as const;

  /**
   * Parsed like the merger proxies: a SPAC's business-combination vote is
   * routinely filed on a general proxy form rather than on `DEFM14A`. Without
   * this override the form was recognised but never parsed, so the proxy stage
   * of the SPAC lifecycle was silently skipped for most filers.
   */
  static override async parse(form: string, txt: string): Promise<FormS1Parsed> {
    return parseRegistrationSubmission(form, txt);
  }

}
