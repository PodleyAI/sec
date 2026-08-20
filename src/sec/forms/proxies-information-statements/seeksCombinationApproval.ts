/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Longest line that can still be a proposal item. A notice-of-meeting item or a
 * table-of-contents row is a heading, not prose; the paragraphs that recite an
 * already-announced combination run to thousands of characters.
 */
const MAX_PROPOSAL_LINE_CHARS = 300;

/**
 * Leading markup a rendered EDGAR document puts in front of a heading: table
 * pipes from the table-of-contents grid, list bullets, and the `1.` / `(2)`
 * numbering of a notice's enumerated items.
 */
const LEAD = String.raw`^[\s|>*#•\-–—]{0,8}(?:\d{1,2}[.)]\s*[|\s]{0,4})?`;

/**
 * Evidence that the meeting this statement calls is being asked to APPROVE a
 * business combination, rather than merely to describe one that has been
 * announced. Matching is case-insensitive and whitespace-insensitive (the prose
 * is rendered from HTML, so runs of whitespace vary).
 *
 * Two shapes, both measured against 348 real SIC-6770 `DEF 14A` / `DEF 14C`
 * statements:
 *
 * 1. A numbered proposal item whose subject is the filer's own defined term —
 *    `Proposal No. 1 — The Business Combination Proposal`, including the
 *    `SPAC Shareholder Proposal No. 1` and `THE PENSARE BUSINESS COMBINATION
 *    PROPOSAL` spellings real filers use.
 * 2. A request to approve or adopt the AGREEMENT: the business combination
 *    agreement, the agreement and plan of merger, or the merger agreement.
 *
 * What is deliberately NOT here, and must not be added:
 *
 * - **A bare `business combination proposal` / `merger proposal` anywhere in
 *   the document.** Every SPAC extension proxy carries the redemption
 *   boilerplate "a pro rata portion of the trust account, as if they had voted
 *   against a business combination proposal", and many cross-reference the
 *   combination's own proposal in a different filing ("see the section entitled
 *   'Proposal No. 1—The Business Combination Proposal' located in the
 *   Registration Statement"). Measured over the corpus that whole-document test
 *   fired on 24 statements, and **every one of them was an extension or annual
 *   meeting**. The term has to be the heading of an item on THIS ballot, which
 *   is why both patterns are line-shaped and the first is anchored at the start
 *   of the line.
 * - **A bare `to approve … business combination`.** That is the standard
 *   extension wording — "to approve an amendment … to extend the date by which
 *   the Company must consummate a business combination". The object of the
 *   approval has to be the AGREEMENT, not the combination as a concept.
 *
 * There is deliberately no extension/annual exclusion term either: a proxy that
 * asks for an extension AND for approval of the combination is a genuine merger
 * proxy, and must still emit.
 */
export const COMBINATION_APPROVAL_SIGNALS: readonly RegExp[] = [
  new RegExp(
    LEAD +
      String.raw`(?:[a-z]+\s+){0,2}proposal\s+(?:no\.?\s*)?\d+\s*[-–—:.]?\s*(?:[^\n]{0,40}?\s)?the\s+(?:[\w&.'-]+\s+){0,3}(?:business\s+combination|merger)\s+proposal\b`,
    "i"
  ),
  /\bto\s+(?:approve|adopt|consider\s+and\s+vote\s+upon)\b[^.]{0,160}?\b(?:business\s+combination\s+agreement|agreement\s+and\s+plan\s+of\s+merger|merger\s+agreement)\b/i,
];

/**
 * Whether a proxy/consent statement's rendered text asks shareholders to
 * approve a business combination.
 *
 * The general definitive forms (`DEF 14A` / `DEF 14C`) carry a SPAC's
 * combination vote often enough to be worth routing to the merger-proxy
 * extractor, but most of them are extension or annual meetings that recite the
 * announced deal at length. An extracted deal alone therefore does not say the
 * meeting APPROVES the combination — and a `proxy` event opens a deal on its
 * own, which downstream turns the next Item 5.07 into a merger `vote` and a
 * Form 25/15 inside the post-approval window into a completed de-SPAC. So the
 * approval evidence is required conjunctively with the extracted deal.
 */
export function seeksCombinationApproval(text: string): boolean {
  if (!text) return false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line === "" || line.length > MAX_PROPOSAL_LINE_CHARS) continue;
    for (const re of COMBINATION_APPROVAL_SIGNALS) {
      if (re.test(line)) return true;
    }
  }
  return false;
}
