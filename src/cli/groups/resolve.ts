/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { resolverIds, isFamilyResolverId } from "../../resolver/resolverIds";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { isValidSemver, VersionRegistry } from "../../storage/versioning/VersionRegistry";
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
    .option("--resolver-version <semver>", "target resolver semver (default: the active slot)")
    .option("--all", "process all observations of the kind", false)
    .option(
      "--renormalize",
      "recompute each observation's derived identity columns from the name as filed " +
        "before resolving (lets a normalizer change take effect without re-extracting)",
      false
    )
    .option(
      "--no-rebuild-roles",
      "--kind person only: skip recomputing person_role. Recomputing is the default " +
        "because nothing else writes a tenure — they are derived from the observations " +
        "and their roster-completeness verdicts, so a person pass that skips it leaves " +
        "the version's tenures as the previous pass left them. It DELETES every tenure " +
        "at the target version before re-deriving, and filings extracted before " +
        "person_observation.role_scope and role_roster_completeness existed derive none " +
        "at all, leaving the version empty — on such a corpus run " +
        "`sec extractor reconstruct-roster-completeness` and re-extract first, or pass " +
        "this flag until you have. The tenures are snapshotted to a file before the purge"
    )
    .action(
      async (opts: {
        kind: string;
        resolverVersion?: string;
        all: boolean;
        renormalize: boolean;
        rebuildRoles: boolean;
      }) => {
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
          // `person_role` is the person tier's, so a company pass never rebuilds
          // it — silently, since the default is on and an operator who ran a
          // company pass did not ask for tenures. Explicitly saying
          // --no-rebuild-roles on a company run is refused rather than accepted
          // as a no-op: the ceremony in docs/identity.md is a person line
          // followed by a company line, which is exactly the shape that gets a
          // flag copied onto both, and a caller who believes the flag is doing
          // something on the company line believes the person line skipped the
          // rebuild too.
          const rebuildRoles = kind === "person" && opts.rebuildRoles;
          if (!opts.rebuildRoles && kind !== "person") {
            throw new Error(
              `--no-rebuild-roles applies to --kind person only: person_role is rebuilt ` +
                `by the person pass, and a '${kind}' pass never touches it.`
            );
          }
          // Default to the ACTIVE slot ("next if a dev cycle exists, else
          // current"), as `version coverage` and the role query already do.
          // The re-key ceremony's renormalize step is documented as required
          // and is silent when skipped, so making an operator look up a semver
          // mid-ceremony is exactly the failure the doc warns about. An
          // explicitly supplied value is still validated; a registry-sourced
          // one already was when it was written.
          let resolverVersion = opts.resolverVersion;
          if (resolverVersion === undefined) {
            const active = await getActiveSlot(
              new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)),
              "resolver",
              kind
            );
            if (!active) {
              throw new Error(
                `No active slot for resolver '${kind}'. Run 'sec db setup' to bootstrap.`
              );
            }
            resolverVersion = active.semver;
          } else if (!isValidSemver(resolverVersion)) {
            throw new Error(`--resolver-version must be a valid semver (got '${resolverVersion}')`);
          }

          const { count, renormalized, rebuilds } =
            await runWorkflowCli<ResolveObservationsTaskOutput>([
              new ResolveObservationsTask({
                defaults: {
                  kind,
                  resolverVersion,
                  renormalize: opts.renormalize,
                  rebuildRoles,
                },
              }),
            ]);
          if (opts.renormalize) {
            console.log(`re-normalized ${renormalized} ${kind} observation(s)`);
          }
          console.log(`resolved ${count} ${kind} observation(s) at v${resolverVersion}`);
          // One line per projection, failure included: a whole-version rebuild
          // that raised leaves its table on the previous pass's canonical ids,
          // which is worth an operator's attention even though the resolve
          // itself succeeded.
          for (const rebuild of rebuilds) {
            if (rebuild.error === null) {
              console.log(`rebuilt ${rebuild.kind}: ${rebuild.rows} row(s) at v${resolverVersion}`);
            } else {
              // stderr: a failure is not part of the result a caller pipes,
              // and the task has already said the same thing there.
              console.error(`rebuild of ${rebuild.kind} FAILED: ${rebuild.error}`);
            }
          }
        });
      }
    );
}
