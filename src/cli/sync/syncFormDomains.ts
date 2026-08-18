/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtractorId } from "../../storage/versioning/extractorIds";
import { formsForExtractorIds } from "../../storage/versioning/extractorIds";

export { formsForExtractorIds };

export const SYNC_FORM_DOMAINS = {
  portals: ["CFPORTAL"],
  crowdfunding: ["C"],
  "reg-a": ["1-A", "1-K", "1-Z", "1-SA", "1-U", "QUALIF", "253G", "1-A-W"],
  "form-d": ["D"],
  spacs: ["S-1", "424", "8-K", "merger-proxy", "25-15"],
} as const satisfies Record<string, readonly ExtractorId[]>;
