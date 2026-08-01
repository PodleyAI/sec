/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_NRSRO_UPD extends Form {
  static readonly name = "NRSRO Update of Registration";
  static readonly description =
    "Update to a previously furnished Form NRSRO, filed by a Nationally Recognized Statistical Rating Organization when information in its registration becomes materially inaccurate.";
  static readonly forms = ["NRSRO-UPD"] as const;
}
