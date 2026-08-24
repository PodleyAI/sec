/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebFieldWidget, type WebFieldWidgetItem } from "@workglow/cli";
import { globalServiceRegistry } from "workglow";
import { queryCiks } from "../cli/queries/CikQuery";
import { queryEntities } from "../cli/queries/EntityQuery";
import { queryFilings } from "../cli/queries/FilingQuery";
import { getVersionStatus } from "../cli/queries/VersionStatus";
import { listResolverIds } from "../resolver/resolverExtensions";
import { CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalSponsorFamilySchema";
import { CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalUnderwriterFamilySchema";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../storage/spac/SpacCandidateSchema";
import { SpacRepo } from "../storage/spac/SpacRepo";
import { EXTRACTOR_IDS } from "../storage/versioning/extractorIds";
import { readPendingDeadLetterCounts } from "./secWebReads";

/**
 * The pickers behind sec's field annotations.
 *
 * A picker exists where the value is an identifier nobody remembers: a CIK, an
 * accession, an extractor id, a canonical family name. Every one of them reads
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

/** Known SPACs only — the vehicles a `spac` row exists for. */
async function searchSpacCiks(query: string): Promise<WebFieldWidgetItem[]> {
  const needle = query.trim().toLowerCase();
  const spacs = await new SpacRepo().getAllSpacs();
  return spacs
    .filter((spac) => {
      if (!needle) return true;
      if (String(spac.cik).startsWith(needle)) return true;
      const names = [spac.spac_name, spac.current_name, spac.target_name];
      return names.some((name) => name?.toLowerCase().includes(needle));
    })
    .slice(0, MAX_ITEMS)
    .map((spac) => ({
      value: String(spac.cik),
      label: spac.spac_name ?? spac.current_name ?? padCik(spac.cik),
      detail: [spac.status, spac.target_name ? `-> ${spac.target_name}` : undefined]
        .filter(Boolean)
        .join(" · "),
    }));
}

/** The cheap screen's worklist, so `spac download` can be aimed by eye. */
async function searchSpacCandidates(query: string): Promise<WebFieldWidgetItem[]> {
  const needle = query.trim().toLowerCase();
  const rows =
    (await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).getOffsetPage(0, 5_000)) ??
    [];
  return rows
    .filter(
      (row) =>
        !needle ||
        String(row.cik).startsWith(needle) ||
        (row.name ?? "").toLowerCase().includes(needle)
    )
    .slice(0, MAX_ITEMS)
    .map((row) => ({
      value: String(row.cik),
      label: row.name ?? padCik(row.cik),
      detail: `${row.confidence} confidence${row.first_reg_form ? ` · ${row.first_reg_form}` : ""}`,
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
  return EXTRACTOR_IDS.filter((id) => !needle || id.toLowerCase().includes(needle))
    .slice(0, MAX_ITEMS)
    .map((id) => ({ value: id, label: id, detail: "parsed form family" }));
}

/**
 * Extractor ids, carrying the two numbers that decide whether you want this one:
 * the version a retry would run under, and how much is waiting on the worklist.
 */
async function searchExtractors(query: string): Promise<WebFieldWidgetItem[]> {
  const needle = query.trim().toLowerCase();
  const [versions, pendingById] = await Promise.all([
    getVersionStatus().catch(() => []),
    readPendingDeadLetterCounts(),
  ]);
  const versionById = new Map(
    versions
      .filter((row) => row.component_kind === "extractor")
      .map((row) => [row.component_id, row])
  );
  return EXTRACTOR_IDS.filter((id) => !needle || id.toLowerCase().includes(needle))
    .slice(0, MAX_ITEMS)
    .map((id) => {
      const version = versionById.get(id);
      const waiting = pendingById.get(id) ?? 0;
      return {
        value: id,
        label: id,
        detail: [
          version ? `v${version.current}` : "unversioned",
          waiting > 0 ? `${waiting} pending` : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    });
}

/**
 * A version ceremony's component id, which is two vocabularies wearing one
 * name: `version promote extractor S-1` and `version coverage resolver person`
 * take the same positional and accept disjoint sets of values.
 *
 * The kind sits beside it on the form, so the picker reads it rather than
 * offering both sets and letting the ceremony reject the wrong half.
 */
async function searchComponentIds(
  query: string,
  context: {
    readonly args: readonly string[];
    readonly values: Readonly<Record<string, string>>;
  }
): Promise<WebFieldWidgetItem[]> {
  const kind = (context.values.kind ?? context.args[0] ?? "").trim();
  if (kind === "resolver") return searchResolverKinds(query);
  if (kind === "extractor") return searchExtractors(query);
  const needle = query.trim().toLowerCase();
  return [...EXTRACTOR_IDS, ...listResolverIds()]
    .filter((id) => !needle || id.toLowerCase().includes(needle))
    .slice(0, MAX_ITEMS)
    .map((id) => ({ value: id, label: id, detail: "choose a kind to narrow this" }));
}

/** Resolver kinds, read off the registry rather than restated here. */
async function searchResolverKinds(query: string): Promise<WebFieldWidgetItem[]> {
  const needle = query.trim().toLowerCase();
  return listResolverIds()
    .filter((id) => !needle || id.toLowerCase().includes(needle))
    .map((id) => ({ value: id, label: id, detail: undefined }));
}

/**
 * Canonical family names, for the alias ceremonies.
 *
 * The kind is read from the form — `sec canonical <kind> alias` puts it in the
 * path, and the two family tiers are separate tables — so one widget serves
 * both rather than the page having to know which command it is on.
 */
async function searchFamilies(
  query: string,
  context: { readonly path: readonly string[] }
): Promise<WebFieldWidgetItem[]> {
  const needle = query.trim().toLowerCase();
  const underwriter = context.path.includes("underwriter-family");
  // Two tables, two row types — read each through its own token rather than a
  // union, which has no common `put` and so is not a storage at all.
  const rows = underwriter
    ? ((await globalServiceRegistry
        .get(CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN)
        .getOffsetPage(0, 5_000)) ?? [])
    : ((await globalServiceRegistry
        .get(CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN)
        .getOffsetPage(0, 5_000)) ?? []);
  return rows
    .flatMap((row) => (row.display_name ? [row.display_name] : []))
    .filter((name) => !needle || name.toLowerCase().includes(needle))
    .slice(0, MAX_ITEMS)
    .map((name) => ({
      value: name,
      label: name,
      detail: underwriter ? "underwriter family" : "sponsor family",
    }));
}

export function registerSecFieldWidgets(): void {
  const source = "@workglow/sec";
  registerWebFieldWidget({ format: "sec:cik", source, search: searchCiks });
  // `TypeSecCik` stamps `format: "cik"` on every CIK port in every sec task
  // schema, so registering the same picker there gives `task run` — and the
  // whole `sec-base` surface — the search box for free, with no annotation.
  registerWebFieldWidget({ format: "cik", source, search: searchCiks });
  registerWebFieldWidget({ format: "sec:spac-cik", source, search: searchSpacCiks });
  registerWebFieldWidget({
    format: "sec:spac-candidate-cik",
    source,
    search: searchSpacCandidates,
  });
  registerWebFieldWidget({ format: "sec:accession", source, search: searchAccessions });
  registerWebFieldWidget({ format: "sec:form", source, search: searchForms });
  registerWebFieldWidget({ format: "sec:extractor", source, search: searchExtractors });
  registerWebFieldWidget({ format: "sec:resolver-kind", source, search: searchResolverKinds });
  registerWebFieldWidget({ format: "sec:component-id", source, search: searchComponentIds });
  registerWebFieldWidget({ format: "sec:family", source, search: searchFamilies });
}
