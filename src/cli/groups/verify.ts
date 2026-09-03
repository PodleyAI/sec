/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import {
  VERIFY_STAGES,
  VerifyFilingTask,
  type VerifyFilingInput,
  type VerifyFilingResult,
} from "../../task/verify/VerifyFilingTask";
import { listFixtures } from "../../verify/loadFilingHtml";
import { parseIntOption } from "../GlobalOptions";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

interface SourceOptions {
  readonly fixture: string | undefined;
  readonly file: string | undefined;
  readonly cik: number | undefined;
  readonly out: string | undefined;
  readonly fetch: boolean | undefined;
  readonly format: string | undefined;
}

function sourceInput(accession: string | undefined, options: SourceOptions): VerifyFilingInput {
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
    .description("Account for what the parser and segmenter did with a filing");

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
    verify.command("all [accession]").description("Every deterministic stage, in order")
  ).action(async (accession, options) => {
    await runCommand(() => run("all", accession, options));
  });
}
