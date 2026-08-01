/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_DRSLTR extends Form {
  static readonly name = "Draft Registration Statement Letter";
  static readonly description =
    "Correspondence relating to a confidential draft registration statement (see DRS). The Reg-A analogue is DOSLTR.";
  static readonly forms = ["DRSLTR"] as const;
}
