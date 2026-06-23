/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { SpacRepo } from "../storage/spac/SpacRepo";
import { SPAC_SPONSOR_LINK_REPOSITORY_TOKEN } from "../storage/canonical/SpacSponsorLinkSchema";
import { UNDERWRITER_LINK_REPOSITORY_TOKEN } from "../storage/canonical/UnderwriterLinkSchema";

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
export async function assembleSpacReport(cik: number, repo: SpacRepo = new SpacRepo()): Promise<SpacReport> {
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
      const report = await assembleSpacReport(cik);
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
      const history = await new SpacRepo().getHistory(cik);
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
}
