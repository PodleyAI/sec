/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { resolverIds, isFamilyResolverId } from "../../resolver/resolverIds";
import { isValidSemver } from "../../storage/versioning/VersionRegistry";
import {
  BATCH_RESOLVABLE_KINDS,
  isBatchResolvableKind,
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
        const kind = opts.kind;
        if (!resolverIds().includes(kind)) {
          throw new Error(`--kind must be one of ${resolverIds().join("|")}`);
        }
        // Only kinds whose resolution input is persisted on the observation row
        // can be re-resolved from storage. A registered kind outside that set is
        // refused rather than run under a kind it was not written for.
        if (!isBatchResolvableKind(kind)) {
          // A family is keyed off the legal name on the observation row via
          // companyFamilyName, but the family-tier fact lives on the link row
          // itself (not a derived identity link), so a batch pass is not yet
          // wired. Re-extraction is the rebuild path.
          const why = isFamilyResolverId(kind)
            ? `; family resolution runs inline during extraction from the ` +
              `legal name — re-extract to rebuild it`
            : "";
          throw new Error(
            `'sec resolve' does not support resolver kind '${kind}' ` +
              `(batch-resolvable kinds: ${BATCH_RESOLVABLE_KINDS.join("|")})${why}`
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

        const { count } = await runWorkflowCli<ResolveObservationsTaskOutput>([
          new ResolveObservationsTask({
            defaults: { kind, resolverVersion: opts.resolverVersion },
          }),
        ]);
        console.log(`resolved ${count} ${kind} observation(s) at v${opts.resolverVersion}`);
      });
    });
}
