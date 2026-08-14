/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { runWorkflowCli } from "../cli/runWorkflow";
import { normalizeSponsorFamilyName } from "../resolver/SponsorFamilyResolver";
import {
  FamilyAliasAddTask,
  type FamilyAliasAddTaskOutput,
} from "../task/canonical/FamilyAliasAddTask";
import { issuerCiksByFamilyName } from "../task/canonical/familyTier";
import {
  IssuersByFamilyTask,
  type IssuersByFamilyTaskOutput,
} from "../task/canonical/IssuersByFamilyTask";
import { registerFamilyAliasExchange } from "./familyAliasExchange";
import { registerFamilyDescribeCommands } from "./familyDescribe";

/**
 * Returns the issuer CIKs of every SPAC backed by the named sponsor family.
 * Alias-aware — see {@link issuerCiksByFamilyName}.
 */
export async function spacIssuersByFamilyName(
  name: string,
  resolverVersion: string
): Promise<number[]> {
  return issuerCiksByFamilyName("sponsor", name, resolverVersion);
}

/**
 * Registers `sec canonical sponsor-family alias|alias-list|alias-import` and
 * `sec spac by-family`.
 * Must be called after {@link addCanonicalCommands} so that `program.commands`
 * already contains the `canonical` subcommand.
 */
export function registerSponsorFamilyCommands(program: Command): void {
  const canonical = program.commands.find((c) => c.name() === "canonical") ?? program;

  const fam = new Command("sponsor-family").description("Manage sponsor-family canonical entities");

  fam
    .command("alias <fromName> <intoName>")
    .description("Merge an AI-emitted variant family name into another")
    .option("--reason <reason>", "why these were merged")
    .option("--resolver-version <v>", "resolver version", "1.0.0")
    .action(
      async (
        fromName: string,
        intoName: string,
        opts: { reason?: string; resolverVersion: string }
      ) => {
        // Expected failures (unknown names, alias chain violations) come back
        // as the task's `error` output port rather than a throw, so this
        // renders identically on a TTY and when piped.
        const out = await runWorkflowCli<FamilyAliasAddTaskOutput>([
          new FamilyAliasAddTask({
            defaults: {
              family: "sponsor",
              fromName,
              intoName,
              reason: opts.reason,
              resolverVersion: opts.resolverVersion,
            },
          }),
        ]);
        if (out.error !== null) {
          console.error(`error: ${out.error}`);
          process.exitCode = 1;
          return;
        }
        console.log(`aliased '${fromName}' -> '${intoName}'`);
      }
    );

  registerFamilyAliasExchange(fam, "sponsor", "sponsor-family");

  registerFamilyDescribeCommands(fam, "sponsor-family", normalizeSponsorFamilyName);

  canonical.addCommand(fam);

  program
    .command("spac")
    .description("SPAC queries")
    .addCommand(
      new Command("by-family")
        .description("List issuer CIKs for SPACs backed by a sponsor family")
        .argument("<name>", "sponsor family display name")
        .option("--resolver-version <v>", "resolver version", "1.0.0")
        .action(async (name: string, opts: { resolverVersion: string }) => {
          const { ciks } = await runWorkflowCli<IssuersByFamilyTaskOutput>([
            new IssuersByFamilyTask({
              defaults: { family: "sponsor", name, resolverVersion: opts.resolverVersion },
            }),
          ]);
          console.log(JSON.stringify(ciks));
        })
    );
}
