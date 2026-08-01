/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_SL extends Form {
  static readonly name = "Sales Literature";
  static readonly description =
    "Sales material furnished in connection with a Regulation A offering, filed on paper against the issuer's 024- offering-statement file number.";
  static readonly forms = ["SL"] as const;
}
