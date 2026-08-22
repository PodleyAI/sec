/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { parseIntOption, parseOutputFormat, type OutputFormat } from "../cli/GlobalOptions";
import { isDryRun } from "../cli/isDryRun";
import { statusMessage } from "../cli/output/Progress";
import { renderTable, type ColumnDef } from "../cli/output/TableRenderer";
import { runCommand } from "../cli/runCommand";
import { runWorkflowCli } from "../cli/runWorkflow";
import {
  DEFAULT_SPAC_ISSUER_CONCURRENCY,
  runSpacTimelineIssuers,
} from "../cli/sync/runSpacTimelineIssuers";
import {
  SPAC_CANDIDATE_CONFIDENCES,
  type SpacCandidateConfidence,
} from "../storage/spac/SpacCandidateSchema";
import {
  ListSpacCandidatesTask,
  type ListSpacCandidatesTaskOutput,
} from "../task/spac/ListSpacCandidatesTask";
import {
  DownloadSpacCandidateDocsTask,
  type DownloadSpacCandidateDocsTaskOutput,
} from "../task/spac/DownloadSpacCandidateDocsTask";
import {
  parseSpacDownloadConfidence,
  type SpacDownloadSet,
} from "../task/spac/spacCandidateDownload";
import { SpacRepo } from "../storage/spac/SpacRepo";
import { type ProcessSpacTimelineTaskOutput } from "../task/spac/ProcessSpacTimelineTask";
import { parseSpacProcessForce } from "../task/spac/parseSpacProcessForce";
import { SPAC_SPONSOR_LINK_REPOSITORY_TOKEN } from "../storage/canonical/SpacSponsorLinkSchema";
import { UNDERWRITER_LINK_REPOSITORY_TOKEN } from "../storage/canonical/UnderwriterLinkSchema";
import type { ExtractorBackfillResult } from "../task/forms/BackfillExtractorTask";
import { BackfillExtractorTask } from "../task/forms/BackfillExtractorTask";
import { BackfillDespacTask, type BackfillDespacTaskOutput } from "../task/spac/BackfillDespacTask";
import { BackfillTrustTask, type BackfillTrustTaskOutput } from "../task/spac/BackfillTrustTask";
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

export { spacProcessRows } from "../cli/sync/runSpacTimelineIssuers";

/**
 * One issuer's replay summary. Partial/failed/triage are omitted when zero so
 * a clean run still reads as `CIK: N/N filings (from → to)`.
 */
export function formatSpacProcessSummary(
  row: ProcessSpacTimelineTaskOutput,
  opts?: { readonly dryRun?: boolean; readonly rebuild?: boolean }
): string {
  const range = `(${row.firstDate} \u2192 ${row.lastDate})`;
  if (opts?.dryRun === true) {
    if (opts.rebuild === true) {
      return `${row.cik}: would rebuild ${row.matched} filings ${range}`;
    }
    if (row.skipped > 0) {
      return `${row.cik}: would replay ${row.matched - row.skipped}/${row.matched} filings (${row.skipped} reused) ${range}`;
    }
    return `${row.cik}: would replay ${row.matched} filings ${range}`;
  }
  const parts = [
    row.skipped > 0
      ? `${row.matched - row.skipped}/${row.matched} filings (${row.skipped} reused) ${range}`
      : `${row.processed}/${row.matched} filings ${range}`,
  ];
  if (row.partial > 0) parts.push(`${row.partial} partial`);
  if (row.failed > 0) parts.push(`${row.failed} failed`);
  if (row.nonfatal > 0) parts.push(`${row.nonfatal} nonfatal`);
  if (row.triage > 0) parts.push(`${row.triage} section(s) pending triage`);
  return `${row.cik}: ${parts.join("; ")}`;
}

/**
 * Inspect hint after a replay that left pending dead-letters. The ids are the
 * ones that actually wrote entries — a SPAC timeline mixes S-1 / 424 / 8-K
 * sub-extractors, so a placeholder `<extractor-id>` is not copy-pasteable.
 */
export function formatSpacProcessDeadLetterHint(
  triageExtractors: string,
  kind: "partial" | "dropped"
): string {
  const ids = triageExtractors === "" ? [] : triageExtractors.split(",");
  const inspect =
    ids.length === 0
      ? "sec extractor dead-letters <extractor-id>"
      : ids.map((id) => `sec extractor dead-letters ${id}`).join("; ");
  if (kind === "dropped") {
    return `Some rows were dropped from otherwise-successful sections. Inspect: ${inspect}`;
  }
  return `Some sections did not extract. Inspect them with: ${inspect}`;
}

export function reportSpacProcessRows(
  rows: readonly ProcessSpacTimelineTaskOutput[],
  opts?: { readonly dryRun?: boolean; readonly rebuild?: boolean }
): void {
  for (const row of rows) {
    if (row.error) {
      console.error(`${row.cik}: ${row.error}`);
    } else if (row.matched === 0) {
      console.log(`${row.cik}: no processable filings`);
    } else {
      console.log(formatSpacProcessSummary(row, opts));
      if (row.partial > 0 || row.failed > 0) {
        console.error(
          statusMessage("warn", formatSpacProcessDeadLetterHint(row.triageExtractors, "partial"))
        );
      } else if (row.triage > 0) {
        console.error(
          statusMessage("info", formatSpacProcessDeadLetterHint(row.triageExtractors, "dropped"))
        );
      }
    }
  }
}

/**
 * Issuers whose replay actually failed — what the command's exit code reports.
 *
 * `partial` deliberately does not count. It is the documented NORMAL outcome of
 * one AI section dead-lettering, and almost every real SPAC has at least one,
 * so counting it made a non-zero exit the default for a healthy run and any
 * script gating on the exit code read a clean replay as a failure. Ownership
 * form misses (`nonfatal`) also do not count — they are off the SPAC timeline's
 * critical path. The warn line and `sec extractor dead-letters <id>` (named
 * from the pending entries) remain the surface for partials.
 */
export function spacProcessFailureCount(rows: readonly ProcessSpacTimelineTaskOutput[]): number {
  return rows.filter((row) => row.error !== "" || row.failed > 0).length;
}

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
    .command("process <ciks...>")
    .description(
      "Replay each SPAC's filings in filing-date order (incremental by default; " +
        "--force rebuilds). Issuers run in parallel; one issuer's filings run serially."
    )
    .option(
      "-c, --concurrency <n>",
      "How many ISSUERS to process at once (default 3). Filings within an issuer are " +
        "always serial — that ordering is what makes the timeline correct.",
      parseIntOption,
      DEFAULT_SPAC_ISSUER_CONCURRENCY
    )
    .option(
      "--force [extractors]",
      "Re-process even when a successful run exists. Bare --force = all extractors; " +
        "--force=S-1,8-K = only those ids."
    )
    .action(async (ciks: string[], opts: { concurrency: number; force?: boolean | string }) => {
      await runCommand(async () => {
        // Fail unknown extractor ids before any wipe or workflow starts.
        const force = parseSpacProcessForce(opts.force);
        const forceInput: string | undefined =
          force.kind === "none" ? undefined : force.kind === "all" ? "all" : force.ids.join(",");
        // parseCikArg reports and returns null on a bad value; drop those so one
        // typo does not abandon the rest of the batch.
        const parsed = ciks.map((c) => parseCikArg(c)).filter((c): c is number => c !== null);
        if (parsed.length === 0) throw new Error("no valid CIKs given");
        const rows = await runSpacTimelineIssuers({
          ciks: parsed,
          concurrency: opts.concurrency,
          force: forceInput,
        });
        reportSpacProcessRows(rows, {
          dryRun: isDryRun(),
          rebuild: force.kind === "all",
        });
        const failed = spacProcessFailureCount(rows);
        if (failed > 0) {
          throw new Error(`${failed} of ${parsed.length} issuer(s) had failed filings`);
        }
      });
    });

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
      if (s.current_trust_amount != null) {
        console.log(
          `  current trust: ${s.current_trust_amount}  as of ${s.current_trust_as_of ?? "-"}`
        );
      }
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
      "List SPAC candidates identified from submissions metadata (populated by `sec sync spacs`)"
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

  const download = spacCmd
    .command("download")
    .description(
      "Pre-fetch accession documents for SPAC candidates into the on-disk cache (no extraction)"
    );

  const addDownloadLeaf = (name: string, set: SpacDownloadSet, blurb: string): void => {
    download
      .command(name)
      .description(blurb)
      .option(
        "--confidence <csv>",
        "Confidence tiers to include (default high,medium)",
        "high,medium"
      )
      .option("--force", "Re-download even when the cache file already exists", false)
      .action(async (opts: { confidence: string; force?: boolean }) => {
        await runCommand(async () => {
          const out = await runWorkflowCli<DownloadSpacCandidateDocsTaskOutput>([
            new DownloadSpacCandidateDocsTask({
              defaults: {
                set,
                confidence: parseSpacDownloadConfidence(opts.confidence),
                force: opts.force === true,
              },
            }),
          ]);
          // The task reports an expected user error on its `error` port rather
          // than throwing, so the workflow renderer cannot `process.exit(1)`
          // out from under the CLI's teardown. Re-raise it here so the non-zero
          // exit comes from `runCommand`, matching `spac process`.
          if (out.error) throw new Error(out.error);
          console.log(
            `SPAC docs: ${out.candidates} candidates; ${out.matched} matched; ` +
              `${out.skipped} skipped (${out.skippedCached} cached, ` +
              `${out.skippedNoFileName} no filename, ${out.skippedUnsafeName} unsafe name); ` +
              `${out.downloaded} downloaded; ${out.failed} failed`
          );
        });
      });
  };

  addDownloadLeaf(
    "registration",
    "registration",
    "Download S-1/F-1/DRS family filings for high+medium SPAC candidates"
  );
  addDownloadLeaf("8k", "8k", "Download every 8-K/8-K/A for high+medium SPAC candidates");
  addDownloadLeaf("everything", "all", "Download every filing for high+medium SPAC candidates");

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

  spacCmd
    .command("backfill-trust")
    .description(
      "Refresh current trust balances for known SPACs from 10-Q/10-K company facts " +
        "(does not overwrite the IPO trust amount)"
    )
    .option("--dry-run", "Report how many rows would change without writing", false)
    .action(async (opts: { dryRun?: boolean }) => {
      const dry = opts.dryRun === true || isDryRun();
      const out = await runWorkflowCli<BackfillTrustTaskOutput>([
        new BackfillTrustTask({ defaults: { dryRun: dry } }),
      ]);
      console.log(
        `selected ${out.selected} SPAC(s); ${dry ? "dry-run would update" : "updated"} ${out.updated}`
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
