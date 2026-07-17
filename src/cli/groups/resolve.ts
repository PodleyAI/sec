/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { RESOLVER_IDS, isFamilyResolverId, type ResolverId } from "../../resolver/resolverIds";
import { isValidSemver } from "../../storage/versioning/VersionRegistry";
import {
  ResolveObservationsTask,
  type ResolveObservationsTaskOutput,
} from "../../task/resolve/ResolveObservationsTask";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

export function addResolveCommands(program: Command): void {
  const cmd = program.command("resolve");
  cmd
    .description("Re-resolve observations into identity-link rows at a target resolver version.")
    .requiredOption("--kind <kind>", "person | company")
    .requiredOption("--resolver-version <semver>", "target resolver semver")
    .option("--all", "process all observations of the kind", false)
    .action(async (opts: { kind: string; resolverVersion: string; all: boolean }) => {
      // runCommand: a validation throw renders a clean error + sets exit code
      // 1 without bypassing the top-level queue/DB teardown (process.exit would).
      await runCommand(async () => {
        if (!RESOLVER_IDS.includes(opts.kind as ResolverId)) {
          throw new Error(`--kind must be one of ${RESOLVER_IDS.join("|")}`);
        }
        // Family-tier resolvers run inline during S-1 extraction (keyed off the
        // sponsor/underwriter common name), not as a batch pass over
        // observations. Refuse here rather than silently running the company
        // resolver and writing mislabeled company identity-link rows.
        if (isFamilyResolverId(opts.kind)) {
          throw new Error(
            `'sec resolve' does not support family resolver kind '${opts.kind}'; ` +
              `family resolution happens inline during S-1 extraction`
          );
        }
        if (!opts.all) {
          throw new Error("--all is required (no other mode supported in v1)");
        }
        if (!isValidSemver(opts.resolverVersion)) {
          throw new Error(
            `--resolver-version must be a valid semver (got '${opts.resolverVersion}')`
          );
        }

        const kind = opts.kind as "person" | "company";
        const { count } = await runWorkflowCli<ResolveObservationsTaskOutput>([
          new ResolveObservationsTask({
            defaults: { kind, resolverVersion: opts.resolverVersion },
          }),
        ]);
        console.log(`resolved ${count} ${kind} observation(s) at v${opts.resolverVersion}`);
      });
    });
}
