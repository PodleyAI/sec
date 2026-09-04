/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_C extends Form {
  static readonly name = "Offering Statement (Regulation Crowdfunding)";
  static readonly description = "Offering Statement (Regulation Crowdfunding)";
  // One EDGAR formc namespace covers every submission type: the post-offering
  // forms (C-U progress update, C-AR annual report, C-TR termination) and every
  // amendment/withdrawal variant.
  static readonly forms = [
    "C",
    "C/A",
    "C-W",
    "C/A-W",
    "C-U",
    "C-U-W",
    "C-AR",
    "C-AR/A",
    "C-AR-W",
    "C-AR/A-W",
    "C-TR",
    "C-TR-W",
  ] as const;
}
