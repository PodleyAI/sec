/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_39_TIA extends Form {
  static readonly name = "Trust Indenture Act Application";
  static readonly description =
    "Application or notice under the Trust Indenture Act of 1939, recorded against a 022- indenture file number. The trailing code is the statutory section invoked: 304(d) (exemption from qualification for a small issue) and 310(b) (relief from the trustee conflict-of-interest provisions).";
  static readonly forms = ["39-304D", "39-304D/A", "39-310B"] as const;
}
