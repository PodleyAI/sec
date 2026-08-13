/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimSectionAtStopHeadings } from "./trimSectionAtStopHeadings";

/** Soft cap for LOI 8-K narratives handed to the model (exhibits already capped upstream). */
export const LOI_TRIM_MAX_CHARS = 100_000;

/** Keep LOI-relevant narrative; hard-cap oversized concatenated exhibits. */
export function trimLoiSectionText(text: string): string {
  return trimSectionAtStopHeadings(text, [], 0, LOI_TRIM_MAX_CHARS);
}
