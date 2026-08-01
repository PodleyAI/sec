/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_SBSE_BD extends Form {
  static readonly name = "Security-Based Swap Entity Registration — Broker-Dealer (Form SBSE-BD)";
  static readonly description =
    "Application for registration as a security-based swap dealer or major security-based swap participant by an entity that is already registered as a broker-dealer.";
  static readonly forms = ["SBSE-BD", "SBSE-BD/A"] as const;
}
