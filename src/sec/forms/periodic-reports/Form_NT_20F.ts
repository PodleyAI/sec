/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_NT_20F extends Form {
  static readonly name = "Late Submission Notification for 20-F";
  static readonly description = "Notification that form 20-F will be submitted late.";
  // EDGAR indexes the notification-of-notification as "NTN 20F" (no hyphen);
  // "NTN 20-F" is the misfiled variant we still want to match.
  static readonly forms = [
    "NT 20-F",
    "NT 20-F/A",
    "NTN 20F",
    "NTN 20F/A",
    "NTN 20-F",
    "NTN 20-F/A",
  ] as const;
}
