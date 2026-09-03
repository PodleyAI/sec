/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_144 extends Form {
  static readonly name = "Notice of Proposed Sale of Securities";
  static readonly description =
    'Filed by "insiders" to give notice of a proposed sale of restricted or control securities under Rule 144. Filed electronically as XML since 2022.';
  static readonly forms = ["144", "144/A"] as const;
}
