/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { parseIntOption, parseOutputFormat, type OutputFormat } from "../cli/GlobalOptions";
import { isDryRun } from "../cli/isDryRun";
import { renderTable, type ColumnDef } from "../cli/output/TableRenderer";
import { runWorkflowCli } from "../cli/runWorkflow";
import {
  SPAC_CANDIDATE_CONFIDENCES,
  type SpacCandidateConfidence,
} from "../storage/spac/SpacCandidateSchema";
import {
  ListSpacCandidatesTask,
  type ListSpacCandidatesTaskOutput,
} from "../task/spac/ListSpacCandidatesTask";
import { SpacRepo } from "../storage/spac/SpacRepo";
import { SPAC_SPONSOR_LINK_REPOSITORY_TOKEN } from "../storage/canonical/SpacSponsorLinkSchema";
import { UNDERWRITER_LINK_REPOSITORY_TOKEN } from "../storage/canonical/UnderwriterLinkSchema";
import type { ExtractorBackfillResult } from "../task/forms/BackfillExtractorTask";
import { BackfillExtractorTask } from "../task/forms/BackfillExtractorTask";
import { BackfillDespacTask, type BackfillDespacTaskOutput } from "../task/spac/BackfillDespacTask";
import { SpacHistoryTask, type SpacHistoryTaskOutput } from "../task/spac/SpacHistoryTask";
import { SpacReportTask } from "../task/spac/SpacReportTask";

export interface SpacReport {
  readonly cik: number;
  readonly spac: Awaited<ReturnType<SpacRepo["getSpac"]>>;
  readonly deals: Awaited<ReturnType<SpacRepo["getDeals"]>>;
  readonly events: Awaited<ReturnType<SpacRepo["getEvents"]>>;
  readonly sponsorCount: number;
  readonly underwriterCount: number;
}

/**
 * Assemble the consolidated report from the spac row + deals + events + linked lists.
 * Sponsor and underwriter counts are obtained by querying the link tables by issuer_cik,
 * since neither SpacSponsorLinkRepo nor UnderwriterLinkRepo exposes a listByIssuer method.
 */
export async function assembleSpacReport(
  cik: number,
  repo: SpacRepo = new SpacRepo()
): Promise<SpacReport> {
  const [spac, deals, events] = await Promise.all([
    repo.getSpac(cik),
    repo.getDeals(cik),
    repo.getEvents(cik),
  ]);

  const sponsorStorage = globalServiceRegistry.get(SPAC_SPONSOR_LINK_REPOSITORY_TOKEN);
  const underwriterStorage = globalServiceRegistry.get(UNDERWRITER_LINK_REPOSITORY_TOKEN);

  const [sponsorRows, underwriterRows] = await Promise.all([
    sponsorStorage.query({ issuer_cik: cik }).then((r) => r ?? []),
    underwriterStorage.query({ issuer_cik: cik }).then((r) => r ?? []),
  ]);

  return {
    cik,
    spac,
    deals,
    events,
    sponsorCount: sponsorRows.length,
    underwriterCount: underwriterRows.length,
  };
}

const SPAC_CANDIDATE_COLUMNS: ReadonlyArray<ColumnDef> = [
  { key: "cik", header: "CIK", width: 9 },
  { key: "name", header: "Name", width: 34 },
  { key: "current_sic", header: "SIC", width: 5 },
  { key: "confidence", header: "Conf", width: 6 },
  { key: "first_reg_form", header: "Reg", width: 6 },
  { key: "first_reg_date", header: "Reg date", width: 10 },
  { key: "signal_renamed_from", header: "Was", width: 28 },
];

/** Parse a CLI CIK argument, returning null (after printing an error) when it is not a non-negative integer. */
function parseCikArg(cikArg: string): number | null {
  const cik = Number(cikArg);
  if (!Number.isInteger(cik) || cik < 0) {
    console.error(`Invalid CIK: ${cikArg}`);
    process.exitCode = 1;
    return null;
  }
  return cik;
}

export function registerSpacCommands(program: Command): void {
  // The sponsorFamily module may have already created the `spac` command (for
  // `by-family`); reuse it so Commander doesn't see a duplicate subcommand.
  let spacCmd = program.commands.find((c) => c.name() === "spac");
  if (!spacCmd) {
    spacCmd = program.command("spac").description("SPAC consolidated report and history");
  }

  spacCmd
    .command("report <cik>")
    .description("Consolidated SPAC report for a CIK")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (cikArg: string, opts: { format: string }) => {
      const cik = parseCikArg(cikArg);
      if (cik === null) return;
      const report = await runWorkflowCli<SpacReport>([new SpacReportTask({ defaults: { cik } })]);
      if (opts.format === "json") {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      if (!report.spac) {
        console.log(`No SPAC record for CIK ${cik}`);
        return;
      }
      const s = report.spac;
      console.log(`SPAC ${cik}: ${s.spac_name ?? "(unknown)"} [${s.status}]`);
      console.log(`  registration: ${s.registration_date ?? "-"}  ipo: ${s.ipo_date ?? "-"}`);
      console.log(`  ipo proceeds: ${s.ipo_proceeds ?? "-"}  trust: ${s.trust_amount ?? "-"}`);
      console.log(`  deals: ${report.deals.length}  events: ${report.events.length}`);
      console.log(`  sponsors: ${report.sponsorCount}  underwriters: ${report.underwriterCount}`);
    });

  spacCmd
    .command("history <cik>")
    .description("State-change history for a SPAC")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (cikArg: string, opts: { format: string }) => {
      const cik = parseCikArg(cikArg);
      if (cik === null) return;
      const { history } = await runWorkflowCli<SpacHistoryTaskOutput>([
        new SpacHistoryTask({ defaults: { cik } }),
      ]);
      if (opts.format === "json") {
        console.log(JSON.stringify(history, null, 2));
        return;
      }
      for (const h of history) {
        console.log(
          `${h.valid_from} [${h.status ?? "-"}] via ${h.change_source}${h.valid_to ? "" : " (current)"}`
        );
      }
    });

  spacCmd
    .command("candidates")
    .description(
      "List SPAC candidates identified from submissions metadata (populated by `sec update spacs`)"
    )
    .option("--confidence <tier>", "Filter to one tier: high | medium | low")
    .option("--limit <n>", "Rows to show", parseIntOption, 50)
    .option("--offset <n>", "Rows to skip", parseIntOption, 0)
    .option("--format <format>", "output format: table | csv | json", parseOutputFormat, "table")
    .action(
      async (opts: {
        confidence?: string;
        limit: number;
        offset: number;
        format: OutputFormat;
      }) => {
        if (
          opts.confidence !== undefined &&
          !SPAC_CANDIDATE_CONFIDENCES.includes(opts.confidence as SpacCandidateConfidence)
        ) {
          console.error(
            `Invalid --confidence "${opts.confidence}". Must be one of: ${SPAC_CANDIDATE_CONFIDENCES.join(", ")}.`
          );
          process.exitCode = 1;
          return;
        }
        const { rows, total } = await runWorkflowCli<ListSpacCandidatesTaskOutput>([
          new ListSpacCandidatesTask({
            defaults: {
              confidence: opts.confidence as SpacCandidateConfidence | undefined,
              limit: opts.limit,
              offset: opts.offset,
            },
          }),
        ]);
        console.log(
          renderTable(rows as unknown as Record<string, unknown>[], SPAC_CANDIDATE_COLUMNS, {
            format: opts.format,
            total,
            offset: opts.offset,
            limit: opts.limit,
          })
        );
      }
    );

  // De-SPAC linkage refresh: the item-2.01 8-K that closes a combination is
  // usually processed BEFORE the surviving entity's renamed submissions land, so
  // post_merger_* start null. This re-runs the linkage over every completed SPAC
  // from now-current entity metadata (idempotent; fills the still-null slots).
  spacCmd
    .command("backfill-despac")
    .description(
      "Refresh post-merger identity (surviving name / SIC / tickers) for completed SPACs " +
        "from current entity metadata"
    )
    .option("--dry-run", "Report the completed-SPAC count without writing", false)
    .action(async (opts: { dryRun?: boolean }) => {
      const dry = opts.dryRun === true || isDryRun();
      const out = await runWorkflowCli<BackfillDespacTaskOutput>([
        new BackfillDespacTask({ defaults: { dryRun: dry } }),
      ]);
      console.log(
        `selected ${out.selected} completed SPAC(s); ${dry ? "dry-run" : `updated ${out.updated}`}`
      );
    });

  // Historical aliases for `sec extractor backfill <id>` — same generalized
  // engine, extractor id fixed.
  const backfillAliases: ReadonlyArray<{ name: string; extractorId: string; blurb: string }> = [
    {
      name: "backfill-redemptions",
      extractorId: "redemption",
      blurb: "Re-process known-SPAC trigger-item 8-Ks to extract realized redemptions",
    },
    {
      name: "backfill-lois",
      extractorId: "loi",
      blurb: "Re-process known-SPAC trigger-item 8-Ks to detect letters of intent",
    },
    {
      name: "backfill-merger-proxies",
      extractorId: "merger-proxy",
      blurb:
        "Re-process known-SPAC merger proxies that were ingested before their spac row existed",
    },
  ];
  for (const alias of backfillAliases) {
    spacCmd
      .command(alias.name)
      .description(`${alias.blurb} (alias for: sec extractor backfill ${alias.extractorId})`)
      .option("--force", "Re-process filings even when a successful run already exists", false)
      .option("--dry-run", "Report selected filing count without reprocessing", false)
      .action(async (opts: { force?: boolean; dryRun?: boolean }) => {
        const out = await runWorkflowCli<ExtractorBackfillResult>([
          new BackfillExtractorTask({
            defaults: {
              extractorId: alias.extractorId,
              force: opts.force === true,
              // Commander resolves `--dry-run` against the program-level global
              // option, so merge both sources.
              dryRun: opts.dryRun === true || isDryRun(),
            },
          }),
        ]);
        console.log(
          `selected ${out.selected} filing(s); processed ${out.processed}; skipped ${out.skipped}`
        );
      });
  }
}
