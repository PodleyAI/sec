/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { runWorkflowCli } from "../cli/runWorkflow";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { OfferingTermsRepo } from "../storage/offering/OfferingTermsRepo";
import type { OfferingTerms } from "../storage/offering/OfferingTermsSchema";
import { SpacUnitTermsRepo } from "../storage/offering/SpacUnitTermsRepo";
import type { SpacUnitTerms } from "../storage/offering/SpacUnitTermsSchema";
import { IssuerDealTask, type IssuerDealTaskOutput } from "../task/offering/IssuerDealTask";

export interface DealField {
  readonly field: string;
  readonly registered: number | string | null;
  readonly priced: number | string | null;
  /** priced - registered when both sides are numeric, else null. */
  readonly delta: number | null;
}

export interface DealComparison {
  readonly kind: "spac" | "equity";
  readonly cik: number;
  readonly registered_accession: string | null;
  readonly priced_accession: string | null;
  readonly fields: readonly DealField[];
}

function field(
  name: string,
  registered: number | string | null | undefined,
  priced: number | string | null | undefined
): DealField {
  const r = registered ?? null;
  const p = priced ?? null;
  const delta = typeof r === "number" && typeof p === "number" ? p - r : null;
  return { field: name, registered: r, priced: p, delta };
}

/** Latest extract for one extractor id; rows arrive newest-first from listByCik. */
function latestFor<T extends { extractor_id: string }>(
  rows: readonly T[],
  extractor_id: string
): T | null {
  return rows.find((r) => r.extractor_id === extractor_id) ?? null;
}

/**
 * Re-sort offering rows by the underlying filing's filing_date (DESC), with
 * accession_number and created_at as tie-breakers. `listByCik` orders by
 * extract recency (`created_at`), which inverts the desired result when an
 * older amendment is re-extracted after a newer one (re-extraction bumps
 * `created_at` but not filing_date). The offering-terms tables don't carry
 * filing_date, so we look it up from the filings table by accession_number.
 */
async function sortByFilingDate<T extends { accession_number: string; created_at: string }>(
  cik: number,
  rows: readonly T[]
): Promise<T[]> {
  if (rows.length === 0) return [];
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const accessionToFilingDate = new Map<string, string>();
  for (const row of rows) {
    if (accessionToFilingDate.has(row.accession_number)) continue;
    const filing = await filingRepo.get({ cik, accession_number: row.accession_number });
    accessionToFilingDate.set(row.accession_number, filing?.filing_date ?? "");
  }
  return [...rows].sort((a, b) => {
    const fdA = accessionToFilingDate.get(a.accession_number) ?? "";
    const fdB = accessionToFilingDate.get(b.accession_number) ?? "";
    return (
      fdB.localeCompare(fdA) ||
      b.accession_number.localeCompare(a.accession_number) ||
      b.created_at.localeCompare(a.created_at)
    );
  });
}

function spacFields(reg: SpacUnitTerms | null, fin: SpacUnitTerms | null): DealField[] {
  return [
    field("units_offered", reg?.units_offered, fin?.units_offered),
    field("price_per_unit", reg?.price_per_unit, fin?.price_per_unit),
    field("gross_proceeds", reg?.gross_proceeds, fin?.gross_proceeds),
    field("net_proceeds", reg?.net_proceeds, fin?.net_proceeds),
    field("trust_per_unit", reg?.trust_per_unit, fin?.trust_per_unit),
    field(
      "warrant_fraction_per_unit",
      reg?.warrant_fraction_per_unit,
      fin?.warrant_fraction_per_unit
    ),
    field("right_fraction_per_unit", reg?.right_fraction_per_unit, fin?.right_fraction_per_unit),
    field("over_allotment_units", reg?.over_allotment_units, fin?.over_allotment_units),
    field("exchange", reg?.exchange, fin?.exchange),
    field("ticker", reg?.ticker, fin?.ticker),
  ];
}

function equityFields(reg: OfferingTerms | null, fin: OfferingTerms | null): DealField[] {
  return [
    field("security_type", reg?.security_type, fin?.security_type),
    field("shares_offered", reg?.shares_offered, fin?.shares_offered),
    field("price", reg?.price, fin?.price),
    field("price_low", reg?.price_low, fin?.price_low),
    field("price_high", reg?.price_high, fin?.price_high),
    field("gross_proceeds", reg?.gross_proceeds, fin?.gross_proceeds),
    field("net_proceeds", reg?.net_proceeds, fin?.net_proceeds),
    field("over_allotment_shares", reg?.over_allotment_shares, fin?.over_allotment_shares),
    field("exchange", reg?.exchange, fin?.exchange),
    field("ticker", reg?.ticker, fin?.ticker),
  ];
}

/**
 * Joins the issuer's registered terms (extractor id "S-1", the latest
 * registration extract — amendments included) against the final priced terms
 * (extractor id "424", from the 424B1/424B4 prospectus). Returns null when the
 * issuer has no extracted terms at all. When both SPAC unit terms and equity
 * terms exist for the CIK, the table containing the priced row wins.
 */
export async function compareIssuerDeal(cik: number): Promise<DealComparison | null> {
  const spacRows = await sortByFilingDate(cik, await new SpacUnitTermsRepo().listByCik(cik));
  const equityRows = await sortByFilingDate(cik, await new OfferingTermsRepo().listByCik(cik));

  const spacReg = latestFor(spacRows, "S-1");
  const spacFin = latestFor(spacRows, "424");
  const eqReg = latestFor(equityRows, "S-1");
  const eqFin = latestFor(equityRows, "424");

  // Prefer the table holding the priced row; with no priced row anywhere,
  // prefer SPAC unit terms when present.
  const useSpac = spacFin !== null || (eqFin === null && spacReg !== null);

  if (useSpac) {
    return {
      kind: "spac",
      cik,
      registered_accession: spacReg?.accession_number ?? null,
      priced_accession: spacFin?.accession_number ?? null,
      fields: spacFields(spacReg, spacFin),
    };
  }
  if (eqReg !== null || eqFin !== null) {
    return {
      kind: "equity",
      cik,
      registered_accession: eqReg?.accession_number ?? null,
      priced_accession: eqFin?.accession_number ?? null,
      fields: equityFields(eqReg, eqFin),
    };
  }
  return null;
}

function formatValue(v: number | string | null): string {
  return v === null ? "—" : String(v);
}

/** Registers `sec issuer deal <cik>` on an existing `issuer` command group. */
export function registerIssuerDealCommand(issuer: Command): void {
  issuer.addCommand(
    new Command("deal")
      .description("Compare registered (S-1) vs final priced (424B1/424B4) offering terms")
      .argument("<cik>", "issuer CIK")
      .option("--format <format>", "Output format (table, json)", "table")
      .action(async (cik: string, opts: { format: string }) => {
        const { comparison } = await runWorkflowCli<IssuerDealTaskOutput>([
          new IssuerDealTask({ defaults: { cik: Number(cik) } }),
        ]);
        if (comparison === null) {
          console.error(`No extracted offering terms for CIK ${cik}.`);
          process.exitCode = 1;
          return;
        }
        if (opts.format === "json") {
          console.log(JSON.stringify(comparison, null, 2));
          return;
        }
        console.log(
          `${comparison.kind.toUpperCase()} deal for CIK ${comparison.cik}\n` +
            `registered: ${comparison.registered_accession ?? "—"}\n` +
            `priced:     ${comparison.priced_accession ?? "—"}\n`
        );
        for (const f of comparison.fields) {
          const delta = f.delta === null ? "" : `\t(${f.delta > 0 ? "+" : ""}${f.delta})`;
          console.log(
            `${f.field}\t${formatValue(f.registered)}\t->\t${formatValue(f.priced)}${delta}`
          );
        }
      })
  );
}
