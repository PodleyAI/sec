/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EVAL_EXTRACTORS } from "./fixtures";
import { extractorsWithGoldenLabels } from "./goldenS1Labels";

/**
 * Which extractors a sweep runs when the operator did **not** name any.
 *
 * `EvalExtractor.disabled` means "exclude from default sweeps" — not "does not
 * exist" — so it belongs here rather than inside either harness's own index.
 * Both harnesses derive their default set through this one predicate, because
 * they previously each decided for themselves: `eval extract` honored the flag
 * and `eval s1` never consulted it, so a bare `sec eval s1` still swept a
 * disabled extractor in full.
 */
export function participatesInDefaultSweeps(extractor: string): boolean {
  return !EVAL_EXTRACTORS[extractor]?.disabled;
}

/**
 * The default `--extractors` set for `sec eval s1 --reference golden`: every
 * extractor carrying at least one committed golden label that also participates
 * in default sweeps.
 *
 * Deliberately NOT folded into {@link extractorsWithGoldenLabels}, which stays
 * the complete factual index of what is labelled — `goldenS1Labels.test.ts`
 * reads it to prove every committed label is reachable and every committed
 * section is labelled, and a filtered index would silently drop a disabled
 * extractor's labels out from under that guard.
 */
export function defaultGoldenSweepExtractors(): string[] {
  return extractorsWithGoldenLabels().filter(participatesInDefaultSweeps);
}
