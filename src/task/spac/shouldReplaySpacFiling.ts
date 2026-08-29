/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { extractorIdsForForm } from "../../sec/forms/formExtractors";
import { hasLoiTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kLoiTriggers";
import { hasRedemptionTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import { filingRunKey } from "../../storage/versioning/ExtractorRunRepo";
import { isSpacRowGatedExtractor } from "../../storage/versioning/extractorIds";
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
  // Every clause below asks about the SET of extractors the form routes to, not
  // about one of them: a filing is replayed when any of its extractors is
  // forced, is gated, or still owes a successful run. Reading a single id would
  // answer each of those for whichever extractor happened to be named first and
  // silently drop the rest of the form's work.
  const extractorIds = extractorIdsForForm(args.form);
  if (extractorIds.length === 0) return false;
  if (args.force.kind === "all") return true;
  if (args.force.kind === "extractors") {
    const forced = new Set<string>(args.force.ids);
    if (extractorIds.some((id) => forced.has(id))) return true;
    // The redemption and LOI passes run inside another extractor's `store`
    // rather than registering forms of their own, so no id in `extractorIds`
    // can name them and matching on one only asks which package registered
    // what. What is true of a filing they would read is the filing itself: it
    // carries an item code the pass keys on, and — by the early return above —
    // some extractor is registered to run over its form at all, which is what
    // gives those passes a `store` to run inside.
    if (
      (forced.has("redemption") && hasRedemptionTriggerItem(args.items)) ||
      (forced.has("loi") && hasLoiTriggerItem(args.items))
    ) {
      return true;
    }
  }
  // The third way past the already-succeeded skip, and the one `spac process`
  // exists for: a gated handler's success row says only that it ran, not that
  // it wrote anything. Selection is evidence-based per filing, so a filing that
  // genuinely had nothing to write stays skipped.
  if (
    extractorIds.some(isSpacRowGatedExtractor) &&
    args.gatedNoOpAccessions.has(args.accession_number)
  ) {
    return true;
  }
  const runKey = filingRunKey(args);
  return extractorIds.some((id) => {
    const keys = args.successfulKeys.get(id);
    return keys === undefined || !keys.has(runKey);
  });
}
