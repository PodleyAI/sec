/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { hasLoiTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kLoiTriggers";
import { hasRedemptionTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import { filingRunKey } from "../../storage/versioning/ExtractorRunRepo";
import { formToExtractorId, isSpacRowGatedExtractor } from "../../storage/versioning/extractorIds";
import type { SpacProcessForce } from "./parseSpacProcessForce";

export function shouldReplaySpacFiling(args: {
  readonly form: string;
  readonly items: string | null | undefined;
  readonly cik: number;
  readonly accession_number: string;
  readonly force: SpacProcessForce;
  readonly successfulKeys: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Accessions whose known-SPAC-gated handler recorded a success while writing
   * nothing, because the `spac` row did not exist yet. See
   * {@link loadGatedNoOpAccessions}.
   */
  readonly gatedNoOpAccessions: ReadonlySet<string>;
}): boolean {
  const extractorId = formToExtractorId(args.form);
  if (extractorId === undefined) return false;
  if (args.force.kind === "all") return true;
  if (args.force.kind === "extractors") {
    const forced = new Set<string>(args.force.ids);
    if (forced.has(extractorId)) return true;
    if (
      extractorId === "8-K" &&
      ((forced.has("redemption") && hasRedemptionTriggerItem(args.items)) ||
        (forced.has("loi") && hasLoiTriggerItem(args.items)))
    ) {
      return true;
    }
  }
  // The third way past the already-succeeded skip, and the one `spac process`
  // exists for: a gated handler's success row says only that it ran, not that
  // it wrote anything. Selection is evidence-based per filing, so a filing that
  // genuinely had nothing to write stays skipped.
  if (isSpacRowGatedExtractor(extractorId) && args.gatedNoOpAccessions.has(args.accession_number)) {
    return true;
  }
  const keys = args.successfulKeys.get(extractorId);
  return keys === undefined || !keys.has(filingRunKey(args));
}
