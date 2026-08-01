/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_N_3_EL extends Form {
  static readonly name = "Separate Account Registration with 24f-2 Election (Form N-3 EL)";
  static readonly description =
    "Registration statement of a separate account offering variable annuity contracts on Form N-3, filed together with an election to register an indefinite number of securities under Rule 24f-2. Legacy submission type; see also N-1A EL and N-4 EL.";
  static readonly forms = ["N-3 EL", "N-3 EL/A"] as const;
}
