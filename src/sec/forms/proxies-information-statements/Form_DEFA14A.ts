/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";
import type { FormS1Parsed } from "../registration-statements/Form_S_1";
import { parseRegistrationSubmission } from "../registration-statements/s1/parseSubmission";

export class Form_DEFA14A extends Form {
  static readonly name = "Additional Proxy Soliciting Materials";
  static readonly description = "Additional proxy soliciting materials - definitive.";
  static readonly forms = ["DEFA14A"] as const;

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
