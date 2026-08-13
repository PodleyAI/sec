/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { globalServiceRegistry, type DataPorts, type ITask } from "workglow";
import { parseIntOption, parseOutputFormat, type OutputFormat } from "../cli/GlobalOptions";
import { isDryRun } from "../cli/isDryRun";
import { renderTable, type ColumnDef } from "../cli/output/TableRenderer";
import { runCommand } from "../cli/runCommand";
import { runWorkflowCli } from "../cli/runWorkflow";
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
import {
  ProcessSpacTimelineTask,
  type ProcessSpacTimelineTaskOutput,
} from "../task/spac/ProcessSpacTimelineTask";
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

/**
 * The `spac process` fan-out's merged output: one column per
 * {@link ProcessSpacTimelineTask} output port, index-aligned across columns.
 */
type SpacProcessColumns = {
  readonly [K in keyof ProcessSpacTimelineTaskOutput]?: ReadonlyArray<
    ProcessSpacTimelineTaskOutput[K]
  >;
};

/**
 * Transposes the fan-out's column arrays back into one row per issuer.
 *
 * The map merges each output port into an array across iterations — always an
 * array, including for the one-issuer run that is the commonest invocation, so
 * there is no scalar shape to unwrap. `cik` is echoed by the task rather than
 * zipped from the input list, so a row can never be reported under the wrong
 * issuer.
 */
export function spacProcessRows(
  columns: SpacProcessColumns
): readonly ProcessSpacTimelineTaskOutput[] {
  const column = <K extends keyof ProcessSpacTimelineTaskOutput>(
    key: K
  ): ReadonlyArray<ProcessSpacTimelineTaskOutput[K] | undefined> => columns[key] ?? [];
  const ciks = column("cik");
  const matched = column("matched");
  const processed = column("processed");
  const firstDate = column("firstDate");
  const lastDate = column("lastDate");
  const error = column("error");
  const rows: ProcessSpacTimelineTaskOutput[] = [];
  for (let i = 0; i < ciks.length; i++) {
    const cik = ciks[i];
    if (cik === undefined) continue;
    rows.push({
      cik,
      matched: matched[i] ?? 0,
      processed: processed[i] ?? 0,
      firstDate: firstDate[i] ?? "",
      lastDate: lastDate[i] ?? "",
      error: error[i] ?? "",
    });
  }
  return rows;
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
      "Replay each SPAC's filings in filing-date order (the whole timeline, not one " +
        "form at a time). Issuers run in parallel; one issuer's filings run serially."
    )
    .option(
      "-c, --concurrency <n>",
      "How many ISSUERS to process at once (default 3). Filings within an issuer are " +
        "always serial — that ordering is what makes the timeline correct.",
      parseIntOption,
      3
    )
    .action(async (ciks: string[], opts: { concurrency: number }) => {
      await runCommand(async () => {
        // parseCikArg reports and returns null on a bad value; drop those so one
        // typo does not abandon the rest of the batch.
        const parsed = ciks.map((c) => parseCikArg(c)).filter((c): c is number => c !== null);
        if (parsed.length === 0) throw new Error("no valid CIKs given");
        const limit = Math.max(1, opts.concurrency);
        // ONE workflow over all issuers, fanned out by a map. The previous
        // hand-rolled pool ran a separate `runWorkflowCli` per issuer, which on
        // a TTY started a second Ink renderer while the first still owned the
        // terminal, and — because the workflow renderer answers a thrown error
        // with `process.exit(1)` — let one issuer's failure kill the whole
        // batch mid-flight, which is exactly what the pool existed to prevent.
        // The task now reports a failure on its `error` port instead of
        // throwing, so nothing in the graph raises.
        const results = await runWorkflowCli<SpacProcessColumns>([], { cik: [...parsed] }, (wf) => {
          const loop = wf.map({
            concurrencyLimit: Math.min(limit, parsed.length),
            maxIterations: parsed.length,
            preserveOrder: true,
          });
          loop.pipe(new ProcessSpacTimelineTask() as ITask<DataPorts, DataPorts>);
          loop.endMap();
        });
        const rows = spacProcessRows(results);
        let failed = 0;
        for (const row of rows) {
          if (row.error) {
            failed++;
            console.error(`${row.cik}: ${row.error}`);
          } else if (row.matched === 0) {
            console.log(`${row.cik}: no processable filings`);
          } else {
            console.log(
              `${row.cik}: ${row.processed}/${row.matched} filings ` +
                `(${row.firstDate} \u2192 ${row.lastDate})`
            );
          }
        }
        if (failed > 0) {
          throw new Error(`${failed} of ${parsed.length} issuer(s) failed`);
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
  addDownloadLeaf(
    "everything",
    "all",
    "Download every filing for high+medium SPAC candidates"
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
