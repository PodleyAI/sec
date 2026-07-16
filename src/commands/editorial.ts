/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "fs";
import type { Command } from "commander";
import { isDryRun } from "../cli/isDryRun";
import { FamilyDescriptionRepo } from "../storage/canonical/FamilyDescriptionRepo";
import {
  FAMILY_DESCRIPTION_KINDS,
  type FamilyDescriptionKind,
} from "../storage/canonical/FamilyDescriptionSchema";
import { SpacRepo } from "../storage/spac/SpacRepo";
import { SpacReportWriter } from "../storage/spac/SpacReportWriter";
import {
  importFamilyDescriptions,
  importSpacEditorial,
  normalizeFamilyNameForKind,
  parseEditorialCsv,
} from "./editorialImport";

function fail(message: string): void {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

/**
 * Registers the `editorial` command group: hand-curated data with no SEC-filing
 * source (spac `url_sponsor` / `url_spac` / `details`, family descriptions).
 * Values survive filing replays (the rollup never clobbers a non-null value
 * with an absent one) and resolver re-mints (family descriptions are keyed by
 * normalized name, outside the canonical tier).
 */
export function registerEditorialCommands(program: Command): void {
  const editorial = program
    .command("editorial")
    .description("Hand-curated editorial data (no SEC-filing source)");

  editorial
    .command("set <cik>")
    .description("Set editorial fields on a SPAC row")
    .option("--url-sponsor <url>", "Sponsor website URL")
    .option("--url-spac <url>", "SPAC website URL")
    .option("--details <json>", "JSON key/value details map")
    .option("--create-missing", "Create the spac row when none exists (marks the CIK a SPAC)")
    .action(
      async (
        cikArg: string,
        opts: { urlSponsor?: string; urlSpac?: string; details?: string; createMissing?: boolean }
      ) => {
        // Digits-only: `Number("")`/`Number(" ")` are 0, which a numeric-only
        // guard would accept as a valid CIK. Mirrors the editorial CSV import.
        const cikText = cikArg.trim();
        const cik = Number(cikText);
        if (!/^\d+$/.test(cikText) || !Number.isSafeInteger(cik)) {
          return fail(`invalid CIK: ${cikArg}`);
        }
        if (
          opts.urlSponsor === undefined &&
          opts.urlSpac === undefined &&
          opts.details === undefined
        ) {
          return fail("nothing to set: pass --url-sponsor, --url-spac, and/or --details");
        }
        if (opts.details !== undefined) {
          try {
            const parsed = JSON.parse(opts.details);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              return fail("--details must be a JSON object");
            }
          } catch {
            return fail("--details must be valid JSON");
          }
        }
        const exists = (await new SpacRepo().getSpac(cik)) !== undefined;
        if (!exists && opts.createMissing !== true) {
          return fail(
            `no spac row for CIK ${cik}; pass --create-missing to create one (marks the CIK a known SPAC)`
          );
        }
        await new SpacReportWriter().recordEditorial({
          cik,
          url_sponsor: opts.urlSponsor,
          url_spac: opts.urlSpac,
          details: opts.details,
        });
        console.log(`updated spac ${cik}${exists ? "" : " (created)"}`);
      }
    );

  editorial
    .command("set-family-description <name> <text>")
    .description("Set the editorial description for a sponsor / underwriter family")
    .requiredOption("--kind <kind>", `one of: ${FAMILY_DESCRIPTION_KINDS.join(" | ")}`)
    .action(async (name: string, text: string, opts: { kind: string }) => {
      const kind = opts.kind as FamilyDescriptionKind;
      if (!FAMILY_DESCRIPTION_KINDS.includes(kind)) {
        return fail(
          `unknown --kind '${opts.kind}'; expected ${FAMILY_DESCRIPTION_KINDS.join(" | ")}`
        );
      }
      const normalized = normalizeFamilyNameForKind(kind, name);
      if (!normalized) return fail("name normalizes to empty");
      await new FamilyDescriptionRepo().setDescription(kind, normalized, text);
      console.log(`described ${kind} '${name}'`);
    });

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
      for (const file of files) {
        let content: string;
        try {
          content = readFileSync(file, "utf8");
        } catch (err) {
          fail(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        const parsed = parseEditorialCsv(content);
        for (const e of parsed.errors) console.error(`${file}: ${e}`);
        if (parsed.errors.length > 0) process.exitCode = 1;

        if (parsed.kind === "family") {
          const res = await importFamilyDescriptions(parsed.familyRows, { dryRun });
          console.log(
            `${file}: ${dryRun ? "would write" : "wrote"} ${res.written} family description(s)` +
              (parsed.errors.length > 0 ? `, ${parsed.errors.length} invalid` : "")
          );
          continue;
        }
        const res = await importSpacEditorial(parsed.spacRows, {
          createMissing: opts.createMissing === true,
          dryRun,
        });
        const skipped =
          res.skippedMissing.length > 0
            ? `, skipped ${res.skippedMissing.length} CIK(s) with no spac row (use --create-missing)`
            : "";
        console.log(
          `${file}: ${dryRun ? "would write" : "wrote"} ${res.written} spac row(s)` +
            (res.created > 0 ? ` (${res.created} created)` : "") +
            skipped +
            (parsed.errors.length > 0 ? `, ${parsed.errors.length} invalid` : "")
        );
      }
    });
}
