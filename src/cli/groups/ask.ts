/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { AskTask, type AskTaskOutput } from "../../task/kb/AskTask";
import {
  DEFAULT_ASK_INDEX_LIMIT,
  IndexFilingSectionsTask,
  type IndexFilingSectionsTaskOutput,
} from "../../task/kb/IndexFilingSectionsTask";
import { parseIntOption } from "../GlobalOptions";
import { isJsonOutput } from "../isJsonOutput";
import { drainNextSteps, suggest } from "../nextSteps";
import { statusMessage } from "../output/Progress";
import { describeUnresolved, resolveCompany } from "../resolveCompany";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

interface ScopeOptions {
  readonly company?: string;
  readonly form?: string;
  readonly since?: string;
  readonly accession?: string;
}

/** The scope flags every command here shares. */
function addScopeOptions(cmd: Command): Command {
  return cmd
    .option("--company <cik|ticker|name>", "Narrow to one issuer")
    .option("--form <form>", "Narrow to one form type, e.g. 10-K")
    .option("--since <date>", "Only filings on or after this date (YYYY-MM-DD)")
    .option("--accession <accession>", "Narrow to one filing");
}

async function resolveScope(
  options: ScopeOptions
): Promise<{ cik?: number; form?: string; since?: string; accession?: string }> {
  const scope: { cik?: number; form?: string; since?: string; accession?: string } = {};
  if (options.company !== undefined) {
    const ref = await resolveCompany(options.company);
    if (ref.kind !== "resolved") throw new Error(describeUnresolved(ref));
    scope.cik = ref.cik;
  }
  if (options.form !== undefined) scope.form = options.form;
  if (options.since !== undefined) scope.since = options.since;
  if (options.accession !== undefined) scope.accession = options.accession;
  return scope;
}

export function addAskCommands(program: Command): void {
  addScopeOptions(
    program
      .command("index")
      .description("Embed converted filing sections so `sec ask` can retrieve them")
  )
    .option("--limit <n>", "Filings to index in this run", parseIntOption)
    .option("--force", "Re-index filings already in the knowledge base", false)
    .action(async (options: ScopeOptions & { limit?: number; force?: boolean }) => {
      await runCommand(async () => {
        const scope = await resolveScope(options);
        const out = await runWorkflowCli<IndexFilingSectionsTaskOutput>([
          new IndexFilingSectionsTask({
            defaults: { ...scope, limit: options.limit, force: options.force === true },
          }),
        ]);
        console.log(
          `indexed ${out.indexed} filing(s) · ${out.sections} sections` +
            (out.skipped > 0 ? ` · ${out.skipped} already indexed` : "") +
            (out.truncated ? " · stopped at --limit, run again for more" : "")
        );
        if (out.indexed > 0 || out.skipped > 0) {
          suggest({ command: 'sec ask "..."', why: "ask a question about what is indexed" });
        } else {
          suggest({
            command: "sec update documents",
            why: "there is nothing converted to index yet",
          });
        }
      });
    });

  addScopeOptions(
    program
      .command("ask <question>")
      .description("Answer a question from indexed filing prose, with citations")
  )
    .option("--top-k <n>", "Excerpts retrieved before answering", parseIntOption)
    .option(
      "--index-limit <n>",
      `Filings to index before answering (default ${DEFAULT_ASK_INDEX_LIMIT})`,
      parseIntOption
    )
    .option("--no-index", "Answer from what is already indexed, indexing nothing first")
    .action(
      async (
        question: string,
        options: ScopeOptions & { topK?: number; index?: boolean; indexLimit?: number }
      ) => {
        await runCommand(async () => {
          const scope = await resolveScope(options);

          // Index what the scope needs first, and say so while doing it. The
          // alternative is an empty answer that looks like the filings say
          // nothing, when in fact nothing was searched.
          //
          // Bounded, because embedding is the expensive half: an unbounded
          // pre-index on a full corpus runs for days on CPU ONNX before the
          // question is so much as read.
          if (options.index !== false) {
            const limit = options.indexLimit ?? DEFAULT_ASK_INDEX_LIMIT;
            const indexed = await runWorkflowCli<IndexFilingSectionsTaskOutput>([
              new IndexFilingSectionsTask({ defaults: { ...scope, limit } }),
            ]);
            if (indexed.indexed > 0) {
              console.log(
                statusMessage(
                  "info",
                  `indexed ${indexed.indexed} filing(s) · ${indexed.sections} sections`
                )
              );
            }
            if (indexed.truncated) {
              console.log(
                statusMessage(
                  "warn",
                  `stopped at ${limit} filing(s); this answer sees only what is indexed. ` +
                    "Run `sec index` for the full build (`--limit` bounds one run), raise " +
                    "`--index-limit`, or pass `--no-index` to answer from the index as it stands."
                )
              );
            }
          }

          const out = await runWorkflowCli<AskTaskOutput>([
            new AskTask({ defaults: { question, ...scope, topK: options.topK } }),
          ]);

          if (isJsonOutput()) {
            console.log(JSON.stringify({ ...out, nextSteps: drainNextSteps() }, null, 2));
            return;
          }

          console.log(`\n${out.answer}\n`);
          for (const reference of out.references) {
            console.log(`  [${reference.index}] ${reference.title}`);
            if (reference.url !== undefined) console.log(`      ${reference.url}`);
          }
          // Which model answered, always. A key-less run uses a small local
          // model and reads visibly worse than a cloud one; saying which ran
          // makes a disappointing answer attributable rather than mysterious.
          console.log(`\n  Answered by ${out.modelId} (${out.modelReason}).`);
          suggest({
            command: "sec show xbrl --cik <cik>",
            why: "for a number, read what the filer tagged rather than what a model read",
          });
        });
      }
    );
}
