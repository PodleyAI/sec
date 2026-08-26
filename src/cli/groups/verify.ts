/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { parseIntOption } from "../GlobalOptions";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";
import { sectionFilePath } from "../../verify/callTrace";
import { listFixtures } from "../../verify/loadFilingHtml";
import { callsForSection, readCallTrace } from "../../verify/readCallTrace";
import {
  VerifyFilingTask,
  VERIFY_STAGES,
  type VerifyFilingResult,
} from "../../task/verify/VerifyFilingTask";

interface SourceOptions {
  readonly fixture?: string;
  readonly file?: string;
  readonly cik?: number;
  readonly out?: string;
  readonly fetch?: boolean;
  readonly format?: string;
}

function sourceInput(accession: string | undefined, options: SourceOptions) {
  return {
    fixture: options.fixture,
    file: options.file,
    cik: options.cik,
    accession,
    fetch: Boolean(options.fetch),
    out: options.out,
  };
}

function percent(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function reportArtifacts(result: VerifyFilingResult): void {
  for (const artifact of result.artifacts) {
    console.log(`  wrote ${artifact.stage} trace → ${artifact.path}`);
  }
}

/** True when the run failed and has printed why. */
function reportError(result: VerifyFilingResult): boolean {
  if (result.error === undefined) return false;
  console.error(result.error);
  process.exitCode = 1;
  return true;
}

function renderParse(result: VerifyFilingResult): void {
  const parse = result.parse;
  if (parse === undefined) return;
  console.log(`\n${result.source}  (${result.sourceKind})`);
  console.log(
    `  ${parse.blocks} blocks (${parse.tables} tables, ${parse.headings} headings) from ${parse.htmlChars} chars of HTML`
  );
  console.log(
    `  ${parse.visibleChars} chars of content: ${percent(parse.coverage)} emitted, ` +
      `${parse.depaginatedChars} de-paginated as furniture, ` +
      `${parse.lostChars === 0 ? "none lost" : `${parse.lostChars} LOST in ${parse.lostRuns} runs`}`
  );
  console.log(
    `  ${parse.ignoredChars} chars ignored (${parse.ignoredRuns} runs carrying no letter or digit)`
  );
  if (parse.drops.length > 0) {
    console.log(
      "  de-paginator: " +
        parse.drops.map((d) => `${d.reason} ${d.blocks} blocks/${d.chars} chars`).join(", ")
    );
  }
  if (parse.worstLost.length > 0) {
    console.log("\n  largest losses:");
    for (const loss of parse.worstLost) {
      console.log(`    ${String(loss.chars).padStart(6)} chars  in ${loss.containedBy}`);
      console.log(`            ${JSON.stringify(loss.text.slice(0, 110))}`);
    }
  }
}

function renderSections(result: VerifyFilingResult): void {
  const sections = result.sections;
  if (sections === undefined) return;
  console.log(
    `\n  sections: ${sections.resolved}/${sections.targets} resolved` +
      (sections.usedLineScan ? "  (line-scan fallback — the tree carried no structure)" : "")
  );
  for (const size of [...sections.sizes].sort((a, b) => b.chars - a.chars)) {
    const at =
      size.source === undefined
        ? "no source mapping"
        : `html ${size.source.start}..${size.source.end}`;
    console.log(`    ${String(size.chars).padStart(8)}  ${size.name.padEnd(46)} ${at}`);
  }
  if (sections.missing.length > 0) console.log(`    missing: ${sections.missing.join(", ")}`);
  if (sections.unresolvedWithHeading.length > 0) {
    console.log(`    heading present but no section: ${sections.unresolvedWithHeading.join(", ")}`);
  }
  for (const containment of sections.unexpectedContainments) {
    console.log(`    UNEXPECTED CONTAINMENT: ${containment}`);
  }
}

function renderChunks(result: VerifyFilingResult): void {
  const chunks = result.chunks;
  if (chunks === undefined) return;
  console.log(
    `\n  risk factors: ${chunks.sectionChars} chars → ${chunks.chunks} chunks` +
      (chunks.oversized ? "  OVERSIZED (would dead-letter)" : "")
  );
  if (!chunks.reassembles) console.log("    CHUNKS DO NOT REASSEMBLE — text lost or invented");
  if (chunks.splitTables > 0) console.log(`    ${chunks.splitTables} chunk edges cut a table`);
  if (chunks.carriedHeadingsNotVerbatim > 0) {
    console.log(
      `    ${chunks.carriedHeadingsNotVerbatim} carried headings are not verbatim section text`
    );
  }
}

function addSourceOptions(cmd: Command): Command {
  return cmd
    .option("--fixture <name>", "A committed golden fixture (see `sec verify fixtures`)")
    .option("--file <path>", "A local HTML file")
    .option("--cik <cik>", "CIK, with an accession argument", parseIntOption)
    .option("--fetch", "Download from EDGAR when the accession is not cached", false)
    .option("--out <dir>", "Write the full trace artifacts to this directory")
    .option("--format <format>", "Output format (text, json)", "text");
}

/**
 * `sec verify` — account for what the pipeline did to a filing, stage by stage.
 *
 * Every command here is deterministic and makes no model call: they read the
 * filing, run the same parser, segmenter and chunker the extractors run, and
 * report what survived. That is what makes them safe to run on anything, and
 * what makes their output comparable across runs.
 */
export function addVerifyCommands(program: Command): void {
  const verify = program
    .command("verify")
    .description("Account for what the parser, segmenter and chunker did with a filing");

  verify
    .command("calls [dir]")
    .description("Summarize a model-call trace written by SEC_TRACE_DIR")
    .option("--section <sha>", "Show every call for one section, by hash prefix")
    .option("--format <format>", "Output format (text, json)", "text")
    .action(async (dirArg: string | undefined, options: Record<string, unknown>) => {
      await runCommand(async () => {
        const dir = dirArg ?? process.env.SEC_TRACE_DIR;
        if (dir === undefined || dir.length === 0) {
          throw new Error("Give a trace directory, or set SEC_TRACE_DIR");
        }
        const section = options.section as string | undefined;
        if (section !== undefined) {
          const calls = callsForSection(dir, section);
          if (options.format === "json") {
            console.log(JSON.stringify(calls, null, 2));
            return;
          }
          if (calls.length === 0) {
            console.log(`No calls for a section matching "${section}".`);
            return;
          }
          console.log(`prose: ${sectionFilePath(dir, calls[0]!.sectionSha256)}`);
          for (const call of calls) {
            console.log(
              `\n  #${call.seq} ${call.label} attempt ${call.attempt} -> ${call.outcome}` +
                ` (${call.durationMs}ms, prompt ${call.promptChars} chars)`
            );
            if (call.errorMessage !== undefined) console.log(`    ${call.errorMessage}`);
            for (const attempt of call.validationAttempts ?? []) {
              for (const error of attempt.errors) {
                console.log(`    attempt ${attempt.attempt}: ${error.path} ${error.message}`);
              }
            }
          }
          return;
        }

        const summary = readCallTrace(dir);
        if (options.format === "json") {
          console.log(JSON.stringify(summary, null, 2));
          return;
        }
        console.log(`${summary.path}: ${summary.calls} calls`);
        if (summary.unreadable > 0) {
          console.log(`  ${summary.unreadable} unreadable line(s) — a run killed mid-append`);
        }
        if (summary.calls === 0) return;
        console.log(
          "  outcomes: " +
            Object.entries(summary.byOutcome)
              .map(([outcome, n]) => `${outcome} ${n}`)
              .join(", ")
        );
        console.log(
          `\n  ${"extractor".padEnd(24)} ${"model".padEnd(22)} calls  sections  retries  in/out tokens`
        );
        for (const group of summary.groups) {
          console.log(
            `  ${group.label.padEnd(24)} ${(group.modelId ?? "-").slice(0, 22).padEnd(22)}` +
              ` ${String(group.calls).padStart(5)} ${String(group.sections).padStart(9)}` +
              ` ${String(group.retries).padStart(8)}  ${group.inputTokens}/${group.outputTokens}`
          );
          const failures = Object.entries(group.byOutcome).filter(([o]) => o !== "ok");
          if (failures.length > 0) {
            console.log(`      ${failures.map(([o, n]) => `${o} ${n}`).join(", ")}`);
          }
        }
      });
    });

  verify
    .command("fixtures")
    .description("List the committed golden fixtures `--fixture` accepts")
    .action(async () => {
      await runCommand(async () => {
        for (const name of listFixtures()) console.log(name);
      });
    });

  const run = async (
    stage: (typeof VERIFY_STAGES)[number] | "all",
    accession: string | undefined,
    options: SourceOptions
  ): Promise<void> => {
    const stages = stage === "all" ? [...VERIFY_STAGES] : [stage];
    const result = await runWorkflowCli<VerifyFilingResult>([
      new VerifyFilingTask({ defaults: { ...sourceInput(accession, options), stages } }),
    ]);
    if (reportError(result)) return;
    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    renderParse(result);
    renderSections(result);
    renderChunks(result);
    reportArtifacts(result);
  };

  addSourceOptions(
    verify
      .command("parse [accession]")
      .description("How much of the filing's visible text survived the HTML parser")
  ).action(async (accession, options) => {
    await runCommand(() => run("parse", accession, options));
  });

  addSourceOptions(
    verify
      .command("sections [accession]")
      .description("Which S-1 sections the segmenter resolved, how big, and what they swallowed")
  ).action(async (accession, options) => {
    await runCommand(() => run("sections", accession, options));
  });

  addSourceOptions(
    verify
      .command("chunks [accession]")
      .description("How the risk-factor section would be split for extraction")
  ).action(async (accession, options) => {
    await runCommand(() => run("chunks", accession, options));
  });

  addSourceOptions(
    verify.command("all [accession]").description("Every deterministic stage, in order")
  ).action(async (accession, options) => {
    await runCommand(() => run("all", accession, options));
  });
}
