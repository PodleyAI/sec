/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { isDryRun } from "../cli/isDryRun";
import { runWorkflowCli } from "../cli/runWorkflow";
import {
  EditorialImportTask,
  type EditorialImportTaskOutput,
} from "../task/editorial/EditorialImportTask";
import { normalizeFamilyNameForKind } from "./editorialImport";

function fail(message: string): void {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

/**
 * Registers the `editorial` command group: hand-curated data with no SEC-filing
 * source (family descriptions, plus whatever a package owning a lifecycle model
 * adds to the same group). Values survive resolver re-mints — family
 * descriptions are keyed by normalized name, outside the canonical tier.
 */
export function registerEditorialCommands(program: Command): void {
  const editorial = program
    .command("editorial")
    .description("Hand-curated editorial data (no SEC-filing source)");

  editorial
    .command("import <csv...>")
    .description(
      "Import editorial CSV(s): 'cik,name,url_spac,url_sponsor,details' or 'family_kind,name,description'"
    )
    .option("--create-missing", "Create spac rows for CIKs with none (marks them known SPACs)")
    .option("--dry-run", "Validate and report without writing")
    .action(async (files: string[], opts: { createMissing?: boolean; dryRun?: boolean }) => {
      // Commander resolves `--dry-run` against the program-level global option
      // (which gates writes via SEC_DRY_RUN), so merge both sources.
      const dryRun = opts.dryRun === true || isDryRun();
      const { results } = await runWorkflowCli<EditorialImportTaskOutput>([
        new EditorialImportTask({
          defaults: { files, createMissing: opts.createMissing === true, dryRun },
        }),
      ]);
      for (const res of results) {
        if (res.readError !== null) {
          fail(res.readError);
          continue;
        }
        if (res.importError !== null) {
          fail(res.importError);
          continue;
        }
        for (const e of res.errors) console.error(`${res.file}: ${e}`);
        if (res.errors.length > 0) process.exitCode = 1;

        if (res.kind === "family") {
          console.log(
            `${res.file}: ${dryRun ? "would write" : "wrote"} ${res.written} family description(s)` +
              (res.errors.length > 0 ? `, ${res.errors.length} invalid` : "")
          );
          continue;
        }
        const skipped =
          res.skippedMissing > 0
            ? `, skipped ${res.skippedMissing} CIK(s) with no spac row (use --create-missing)`
            : "";
        console.log(
          `${res.file}: ${dryRun ? "would write" : "wrote"} ${res.written} spac row(s)` +
            (res.created > 0 ? ` (${res.created} created)` : "") +
            skipped +
            (res.errors.length > 0 ? `, ${res.errors.length} invalid` : "")
        );
      }
    });
}
