/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export interface FormS1Parsed {
  readonly html: string;
}

export class Form_S_1 extends Form {
  static readonly name = "Registration Statement (S-1)";
  static readonly description = "Initial registration statement for new securities.";
  static readonly forms = ["S-1", "S-1/A", "S-1MEF"] as const;

  /**
   * S-1 bodies are narrative HTML, not structured XML, so there is nothing to
   * coerce here — the real extraction happens in processFormS1(). We return the
   * raw HTML so the downstream pipeline can normalize and segment it.
   */
  static override async parse(_form: string, html: string): Promise<FormS1Parsed> {
    return { html };
  }
}
