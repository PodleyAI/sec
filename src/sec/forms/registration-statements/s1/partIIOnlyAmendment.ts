/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A registration amendment carrying no prospectus at all.
 *
 * Most `S-1/A` filings restate the whole prospectus, but a large minority are
 * filed only to add exhibits or answer a comment letter. Those contain the
 * cover page, Part II (Items 13–17), the exhibit index and signatures — and
 * nothing else. WinVest's Amendment No. 1 is 31k characters of rendered text
 * against a real prospectus's 735k.
 *
 * Sweeping one for ten prospectus sections dead-letters every one as
 * SECTION_NOT_FOUND, which is noise of exactly the same kind as the S-1MEF case
 * (`SECTIONLESS_REGISTRATION_FORMS`) — but form type cannot identify it here,
 * because the same form usually DOES carry a prospectus. It has to be decided
 * from content.
 *
 * The discriminator must separate "no prospectus present" from "a prospectus we
 * failed to segment", so it deliberately avoids anything derived from heading
 * detection — that is the machinery in doubt. Instead it asks whether the
 * document mentions risk factors ANYWHERE. Item 105 makes the section mandatory
 * and every real prospectus cross-references it repeatedly (Constellation's had
 * 15 mentions even when segmentation was finding a single section), so its total
 * absence means there is no prospectus to find. The length ceiling is a second,
 * independent guard: a document long enough to hold a prospectus is treated as a
 * real failure worth triaging even if the phrase somehow never appears.
 */

/**
 * Rendered-text ceiling. Part II-only amendments run ~31k characters; the
 * smallest real prospectuses in the corpus are several hundred thousand. Set
 * well above the former and well below the latter so neither edge is close.
 */
const MAX_PART_II_ONLY_CHARS = 120_000;

/** Tag-tolerant: the phrase is often split across `<b>`/`<br>` in EDGAR markup. */
const RISK_FACTORS_RE = /risk\s*(?:<[^>]*>\s*)*factors/i;

/** Cheap tag strip — good enough to measure length; not a renderer. */
function approximateTextLength(html: string): number {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
}

/**
 * Whether `html` is a registration amendment with no prospectus body.
 *
 * Call ONLY when segmentation found no target sections: on its own a missing
 * risk-factors mention is not evidence of anything.
 */
export function looksLikePartIIOnlyAmendment(html: string): boolean {
  if (RISK_FACTORS_RE.test(html)) return false;
  return approximateTextLength(html) <= MAX_PART_II_ONLY_CHARS;
}
