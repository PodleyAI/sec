/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TableNode } from "workglow";
import { Form_8_K_ITEMS } from "../forms/miscellaneous-filings/Form_8_K";
import type { ResolvedStyle } from "./types";

/** `Item 5.02`, `ITEM 1.01.`, `Item 2.02 –` — the number and whatever separates it. */
const ITEM_LEAD = /^\s*item\s+(\d+\.\d+)\s*[.:–—-]?\s*/i;

/** Compared on letters and digits, so case and the filer's punctuation do not matter. */
const compare = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The heading text of a table that is really one Form 8-K item heading, or
 * undefined when the table is a table.
 *
 * Filers typeset an item heading as a two-cell row — the number pinned to a tab
 * stop, the title beside it — which is a layout box rather than data:
 *
 * ```html
 * <table><tr>
 *   <td style="width: 81pt"><div style="font-weight: bold;">Item 8.01</div></td>
 *   <td><div style="font-weight: bold;">Other Events.</div></td>
 * </tr></table>
 * ```
 *
 * The title is what identifies it, not the shape. Form 8-K prescribes the
 * wording of every item, so {@link Form_8_K_ITEMS} is a closed vocabulary and an
 * exact match against it is a fact rather than a guess. Measured over the
 * committed 8-K fixtures, 55 424B3 supplements and the S-1 corpus, 35 of the 37
 * blocks leading with `Item N.NN` carry exactly the prescribed title.
 *
 * The two that do not are the reason the match is exact rather than a prefix.
 * Both are a **table of contents**, which prints the same item text and then
 * runs on into a page number and the next item — so requiring the title to end
 * where the regulation ends it rejects an index by construction, with no
 * counting of rows or cells. (A prefix test does not: all 37 pass it.)
 *
 * A table with a caption is left alone, as with every other unwrap: the caption
 * is information a heading has nowhere to put.
 */
export function itemHeadingFromTable(node: TableNode): string | undefined {
  if (node.caption) return undefined;
  const cells = [...node.headerRows, ...node.rows].flat();
  const filled = cells.map((c) => c.text.trim()).filter((t) => t !== "");
  if (filled.length === 0) return undefined;
  const text = filled.join(" ");
  const lead = ITEM_LEAD.exec(text);
  if (lead === null) return undefined;
  const canonical = Form_8_K_ITEMS[lead[1]!];
  if (canonical === undefined) return undefined;
  if (compare(text.slice(lead[0].length)) !== compare(canonical)) return undefined;
  // As filed: the reader's section title should read the way the filing does.
  return text;
}

/**
 * The style a recovered item heading is ranked with.
 *
 * It has none of its own — the cells' styling was consumed building the table —
 * so this states what the filing means: a section heading at body size, which
 * ranks it below the cover-page lines set larger and centered and above nothing.
 * `upperRatio` is measured from the text rather than assumed, so a filer writing
 * `ITEM 1.01.` ranks with the document's other all-caps headings, which is how
 * it reads on the page.
 */
export function itemHeadingStyle(text: string): ResolvedStyle {
  const letters = text.replace(/[^a-zA-Z]/g, "");
  const upper = letters.replace(/[^A-Z]/g, "");
  return {
    fontSizePt: 10,
    bold: true,
    italic: false,
    underline: false,
    centered: false,
    upperRatio: letters.length === 0 ? 0 : upper.length / letters.length,
  };
}
