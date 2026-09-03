/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebFieldWidget, type WebFieldWidgetItem } from "@workglow/cli";
import { queryCiks } from "../cli/queries/CikQuery";
import { queryEntities } from "../cli/queries/EntityQuery";
import { queryFilings } from "../cli/queries/FilingQuery";
import { ALL_FORMS_MAP } from "../sec/forms/all-forms";

/**
 * The pickers behind sec's field annotations.
 *
 * A picker exists where the value is an identifier nobody remembers: a CIK, an
 * accession, an extractor id. Every one of them reads
 * only what is already stored — this surface must never fetch from EDGAR, since
 * it answers a keystroke and EDGAR's budget is metered and shared.
 */

/** A page of options is a page: nobody scrolls a picker past this. */
const MAX_ITEMS = 25;

function padCik(cik: number | string): string {
  return String(cik).padStart(10, "0");
}

function isCikLike(query: string): boolean {
  return /^\d+$/.test(query.trim());
}

/**
 * Turns a scoped field's value into the CIK it names.
 *
 * The CIK may be a positional argument or a `--cik` flag depending on the
 * command, so both are consulted: an accession picker on `query xbrl` reads the
 * flag, and one on a command taking `<cik>` first reads the argument.
 */
function scopedCik(context: {
  readonly args: readonly string[];
  readonly values: Readonly<Record<string, string>>;
}): number | undefined {
  const candidates = [context.values.cik, ...context.args];
  for (const candidate of candidates) {
    if (candidate && /^\d+$/.test(candidate.trim())) {
      return Number.parseInt(candidate.trim(), 10);
    }
  }
  return undefined;
}

/**
 * Filers, by name or by CIK.
 *
 * Searches `entities` — the filers whose data is actually stored — and falls
 * back to the `cik_names` index only when that finds nothing, because the
 * fallback streams a million-row table to answer a substring and is worth
 * paying for exactly once: when the filer you are asking about has not been
 * ingested yet, which is precisely when `sec fetch submissions` is the command
 * you are composing.
 */
async function searchCiks(query: string): Promise<WebFieldWidgetItem[]> {
  const needle = query.trim();
  const entities = await queryEntities(
    isCikLike(needle)
      ? { cik: Number.parseInt(needle, 10), limit: MAX_ITEMS }
      : { search: needle || undefined, limit: MAX_ITEMS }
  );
  const items = entities.rows.map((entity) => ({
    value: String(entity.cik),
    label: entity.name ?? padCik(entity.cik),
    detail: [padCik(entity.cik), entity.sic ? `SIC ${entity.sic}` : undefined]
      .filter(Boolean)
      .join(" · "),
  }));
  if (items.length > 0 || needle === "") return items;

  const ciks = await queryCiks({ name: needle, limit: MAX_ITEMS });
  return ciks.rows.map((row) => ({
    value: String(row.cik),
    label: row.name ?? padCik(row.cik),
    detail: `${padCik(row.cik)} · not ingested`,
  }));
}

/**
 * Accessions belonging to the CIK the form has already named.
 *
 * Unscoped this picker would be an offer to page through every filing ever
 * ingested, which is not an offer; with no CIK chosen it says so instead.
 */
async function searchAccessions(
  query: string,
  context: { readonly args: readonly string[]; readonly values: Readonly<Record<string, string>> }
): Promise<WebFieldWidgetItem[]> {
  const cik = scopedCik(context);
  if (cik === undefined) return [];
  const needle = query.trim().toLowerCase();
  const filings = await queryFilings({ cik, limit: 500 });
  return filings.rows
    .filter(
      (filing) =>
        !needle ||
        filing.accession_number.toLowerCase().includes(needle) ||
        (filing.form ?? "").toLowerCase().includes(needle)
    )
    .slice(0, MAX_ITEMS)
    .map((filing) => ({
      value: filing.accession_number,
      label: filing.accession_number,
      detail: [filing.form, filing.filing_date].filter(Boolean).join(" · "),
    }));
}

/** Form types this CIK actually filed, falling back to the ones sec parses. */
async function searchForms(
  query: string,
  context: { readonly args: readonly string[]; readonly values: Readonly<Record<string, string>> }
): Promise<WebFieldWidgetItem[]> {
  const needle = query.trim().toLowerCase();
  const cik = scopedCik(context);
  if (cik !== undefined) {
    const filings = await queryFilings({ cik, limit: 2_000 });
    const counts = new Map<string, number>();
    for (const filing of filings.rows) {
      if (!filing.form) continue;
      counts.set(filing.form, (counts.get(filing.form) ?? 0) + 1);
    }
    const items = [...counts.entries()]
      .filter(([form]) => !needle || form.toLowerCase().includes(needle))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ITEMS)
      .map(([form, count]) => ({
        value: form,
        label: form,
        detail: `${count} filed`,
      }));
    if (items.length > 0) return items;
  }
  // The fallback offers every form symbol the dictionary knows, which is what
  // `--types` takes.
  return [...ALL_FORMS_MAP.keys()]
    .filter((form) => !needle || form.toLowerCase().includes(needle))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_ITEMS)
    .map((form) => ({ value: form, label: form, detail: "parsed form type" }));
}

export function registerSecFieldWidgets(): void {
  const source = "sec";
  registerWebFieldWidget({ format: "sec:cik", source, search: searchCiks });
  // `TypeSecCik` stamps `format: "cik"` on every CIK port in every sec task
  // schema, so registering the same picker there gives `task run` — and the
  // whole `sec-base` surface — the search box for free, with no annotation.
  registerWebFieldWidget({ format: "cik", source, search: searchCiks });
  registerWebFieldWidget({ format: "sec:accession", source, search: searchAccessions });
  registerWebFieldWidget({ format: "sec:form", source, search: searchForms });
}
