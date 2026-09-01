/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { runWorkflowCli } from "../cli/runWorkflow";
import {
  IssuerTickersTask,
  type IssuerTickersTaskOutput,
} from "../task/offering/IssuerTickersTask";
import { issuerCommandGroup } from "./issuerGroup";
import { registerIssuerDealCommand } from "./issuerDeal";

/**
 * Registers the `sec issuer` subcommands this package owns.
 *
 * They used to hang off the group created inside the underwriter-family command
 * file, which read as harmless while both shipped together. They do not: the
 * family tier belongs to whoever owns the SPAC and IPO model, and taking that
 * file would have taken these with it. Tickers and offering terms are read off
 * this package's own tables, so they register from here.
 */
export function registerIssuerCommands(program: Command): void {
  issuerCommandGroup(program).addCommand(
    new Command("tickers")
      .description("List the point-in-time ticker series for an issuer CIK")
      .argument("<cik>", "issuer CIK")
      .action(async (cik: string) => {
        try {
          const { rows } = await runWorkflowCli<IssuerTickersTaskOutput>([
            new IssuerTickersTask({ defaults: { cik: Number(cik) } }),
          ]);
          for (const r of rows) {
            console.log(
              `${r.filing_date ?? ""}\t${r.exchange}\t${r.ticker}\t${r.is_primary ? "primary" : ""}`
            );
          }
        } catch (e) {
          console.error(`error: ${(e as Error).message}`);
          process.exitCode = 1;
          return;
        }
      })
  );
  registerIssuerDealCommand(issuerCommandGroup(program));
}
