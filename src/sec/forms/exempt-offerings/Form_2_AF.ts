/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_2_AF extends Form {
  static readonly name = "Reg-A Final Report of Sales and Uses of Proceeds";
  static readonly description =
    "Final report of sales of securities and use of proceeds under Regulation A, closing out the periodic 2-A series for a 024- offering statement.";
  static readonly forms = ["2-AF"] as const;
}
