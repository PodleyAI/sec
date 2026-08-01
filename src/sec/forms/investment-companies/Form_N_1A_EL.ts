/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_N_1A_EL extends Form {
  static readonly name = "Open End Management Investment Company Registration with 24f-2 Election";
  static readonly description =
    "Registration statement of open-end management investment companies filed on Form N-1A together with an election to register an indefinite number of shares under Rule 24f-2. Legacy submission type, largely superseded by plain N-1A after the 1997 amendments to Rule 24f-2.";
  static readonly forms = ["N-1A EL", "N-1A EL/A"] as const;
}
