/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_N_2 extends Form {
  static readonly name = "Closed End Management Investment Company Registration";
  static readonly description =
    "Registration statement of closed-end management investment companies";
  // N-2ASR is the automatic shelf registration statement available to
  // well-known seasoned issuers registering on Form N-2.
  static readonly forms = ["N-2", "N-2/A", "N-2MEF", "N-2ASR", "N-2 POSASR"] as const;
}
