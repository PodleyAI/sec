/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import type { ResolverCoverageResult } from "../queries/ResolverCoverage";
import type { VersionCoverageResult } from "../queries/VersionCoverage";
import { isRegisteredComponent } from "../../storage/versioning/componentRegistry";
import {
  COMPONENT_KINDS,
  COMPONENT_VERSION_REPOSITORY_TOKEN,
  ComponentKind,
} from "../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import type { TaskPorts } from "../../task/taskPorts";
import { ResolverCoverageTask } from "../../task/versioning/ResolverCoverageTask";
import { VersionCoverageTask } from "../../task/versioning/VersionCoverageTask";
import {
  VersionDropNextTask,
  type VersionDropNextTaskOutput,
} from "../../task/versioning/VersionDropNextTask";
import {
  VersionDropPreviousTask,
  type VersionDropPreviousTaskOutput,
} from "../../task/versioning/VersionDropPreviousTask";
import {
  VersionHistoryTask,
  type VersionHistoryTaskOutput,
} from "../../task/versioning/VersionHistoryTask";
import {
  VersionPromoteTask,
  type VersionPromoteTaskOutput,
} from "../../task/versioning/VersionPromoteTask";
import {
  VersionRollbackTask,
  type VersionRollbackTaskOutput,
} from "../../task/versioning/VersionRollbackTask";
import {
  VersionStartDevTask,
  type VersionStartDevTaskOutput,
} from "../../task/versioning/VersionStartDevTask";
import {
  VersionStatusTask,
  type VersionStatusTaskOutput,
} from "../../task/versioning/VersionStatusTask";
import { parseGlobalOptions } from "../GlobalOptions";
import { renderTable } from "../output/TableRenderer";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

function assertComponentKind(s: string): asserts s is ComponentKind {
  if (!(COMPONENT_KINDS as readonly string[]).includes(s)) {
    throw new Error(
      `Invalid component kind '${s}'. Expected one of: ${COMPONENT_KINDS.join(", ")}`
    );
  }
}

function assertBump(s: string): asserts s is "major" | "minor" | "patch" {
  if (s !== "major" && s !== "minor" && s !== "patch") {
    throw new Error(`Invalid --bump '${s}'. Expected: major, minor, patch`);
  }
}

const SUPPORTED_STATUS_FORMATS = ["table", "json"] as const;
function assertFormat(s: string): asserts s is "table" | "json" {
  if (!(SUPPORTED_STATUS_FORMATS as readonly string[]).includes(s)) {
    throw new Error(
      `Invalid --format '${s}'. Expected one of: ${SUPPORTED_STATUS_FORMATS.join(", ")}`
    );
  }
}

export function addVersionCommands(program: Command): void {
  const version = program
    .command("version")
    .description("Inspect and manage extractor/resolver versions");

  // status
  version
    .command("status")
    .description("Show the current/previous/next version of every component")
    .option("--format <format>", "Output format (table, json)", "table")
    .action(async (options: Record<string, string>) => {
      await runCommand(async () => {
        assertFormat(options.format);
        const { rows } = await runWorkflowCli<VersionStatusTaskOutput>([new VersionStatusTask()]);

        if (options.format === "json") {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        if (rows.length === 0) {
          console.log("No components registered.");
          return;
        }
        const tableRows = rows.map((r) => ({
          ...r,
          next:
            r.next === "—"
              ? r.next
              : r.next_coverage_complete
                ? `${r.next} (ready)`
                : `${r.next} (in progress)`,
        }));
        console.log(
          renderTable(
            tableRows as unknown as ReadonlyArray<Record<string, unknown>>,
            [
              { key: "component_kind", header: "Kind", width: 10 },
              { key: "component_id", header: "Id", width: 24 },
              { key: "previous", header: "Previous", width: 16 },
              { key: "current", header: "Current", width: 16 },
              { key: "next", header: "Next", width: 28 },
            ],
            { format: "table" }
          )
        );
      });
    });

  // history
  version
    .command("history <kind> <id>")
    .description("Show recent ceremony events for a component")
    .option("--limit <n>", "Maximum number of events to show", "20")
    .option("--format <format>", "Output format (table, json)", "table")
    .action(async (kind: string, id: string, options: Record<string, string>) => {
      await runCommand(async () => {
        assertComponentKind(kind);
        assertFormat(options.format);
        const limit = parseInt(options.limit, 10);
        if (Number.isNaN(limit) || limit < 1) {
          throw new Error(`Invalid --limit '${options.limit}'. Expected positive integer.`);
        }
        const { events } = await runWorkflowCli<VersionHistoryTaskOutput>([
          new VersionHistoryTask({ defaults: { kind, id, limit } }),
        ]);
        if (options.format === "json") {
          console.log(JSON.stringify(events, null, 2));
          return;
        }
        if (events.length === 0) {
          console.log(`No history for ${kind}:${id}.`);
          return;
        }
        console.log(
          renderTable(
            events as unknown as ReadonlyArray<Record<string, unknown>>,
            [
              { key: "at_timestamp", header: "When", width: 24 },
              { key: "event_type", header: "Event", width: 12 },
              { key: "from_semver", header: "From", width: 12 },
              { key: "to_semver", header: "To", width: 12 },
              { key: "bump_type", header: "Bump", width: 8 },
              { key: "notes", header: "Notes", width: 40 },
            ],
            { format: "table" }
          )
        );
      });
    });

  // coverage
  version
    .command("coverage <kind> <id>")
    .description("Show major-promote coverage for a component")
    .option("--format <format>", "Output format (table, json)", "table")
    .action(async (kind: string, id: string, options: Record<string, string>) => {
      await runCommand(async () => {
        assertComponentKind(kind);
        assertFormat(options.format);
        if (kind === "resolver") {
          const result = await runWorkflowCli<TaskPorts<ResolverCoverageResult>>([
            new ResolverCoverageTask({ defaults: { id } }),
          ]);
          if (options.format === "json") {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          console.log(
            `resolver:${result.kind}@${result.resolver_version}: ${result.numerator}/${result.denominator} (${(result.fraction * 100).toFixed(1)}%)`
          );
          return;
        }
        const result = await runWorkflowCli<TaskPorts<VersionCoverageResult>>([
          new VersionCoverageTask({ defaults: { kind, id } }),
        ]);
        if (options.format === "json") {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(
          `${result.component_kind}:${result.component_id}\n` +
            `  Status:     ${result.status}\n` +
            `  Next:       ${result.next_semver ?? "—"} (${result.bump_type ?? "—"})\n` +
            `  Target:     ${result.target_count ?? "—"}\n` +
            `  Successful: ${result.successful_count ?? "—"}\n` +
            `  Percent:    ${result.percent !== null ? `${result.percent}%` : "—"}`
        );
      });
    });

  // start-dev
  version
    .command("start-dev <kind> <id> <semver>")
    .description("Begin a dev cycle for a component (or apply a patch in place)")
    .requiredOption("--bump <type>", "Bump type: major, minor, or patch")
    .option("--notes <text>", "Optional notes for the audit log", "")
    .action(
      async (
        kind: string,
        id: string,
        semver: string,
        options: Record<string, string | boolean>
      ) => {
        await runCommand(async () => {
          assertComponentKind(kind);
          const bumpArg = options.bump as string;
          assertBump(bumpArg);
          if (!isRegisteredComponent(kind, id)) {
            throw new Error(`No ${kind} registered: '${id}'`);
          }
          // For non-patch bumps, fail-fast if a dev cycle is already in flight
          // — saves the snapshotTargetCount filing-set materialization.
          if (bumpArg !== "patch") {
            const regCheck = new VersionRegistry(
              globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
            );
            const existingNext = await regCheck.getNext(kind, id);
            if (existingNext) {
              throw new Error(
                `next slot already exists for ${kind} '${id}' (at ${existingNext.semver}). drop-next first.`
              );
            }
          }
          const notes =
            typeof options.notes === "string" && options.notes !== "" ? options.notes : null;
          const dryRun = parseGlobalOptions(program).dryRun;
          const { targetCount } = await runWorkflowCli<VersionStartDevTaskOutput>([
            new VersionStartDevTask({
              defaults: { kind, id, semver, bump: bumpArg, notes, dryRun },
            }),
          ]);
          if (dryRun) {
            console.log(
              `(dry-run) start-dev ${kind} ${id} ${semver} --bump ${bumpArg} would succeed${
                targetCount !== null ? ` (would snapshot target_count=${targetCount})` : ""
              }`
            );
          } else if (bumpArg === "patch") {
            console.log(`Patched ${kind}:${id} → ${semver} (in place)`);
          } else {
            console.log(
              `Started dev cycle: ${kind}:${id} ${semver} --bump ${bumpArg}${
                targetCount !== null ? ` (target_count=${targetCount})` : ""
              }`
            );
          }
        });
      }
    );

  // promote
  version
    .command("promote <kind> <id>")
    .description("Promote the next slot to current (slot rotation)")
    .option("--force", "Bypass the major-bump coverage gate", false)
    .option("--notes <text>", "Optional notes for the audit log", "")
    .action(async (kind: string, id: string, options: Record<string, boolean | string>) => {
      await runCommand(async () => {
        assertComponentKind(kind);
        const notes =
          typeof options.notes === "string" && options.notes !== "" ? options.notes : null;
        const dryRun = parseGlobalOptions(program).dryRun;
        const { eligibleDeadLetters } = await runWorkflowCli<VersionPromoteTaskOutput>([
          new VersionPromoteTask({
            defaults: { kind, id, force: options.force === true, notes, dryRun },
          }),
        ]);
        console.log(
          dryRun ? `(dry-run) promote ${kind} ${id} would succeed` : `Promoted ${kind}:${id}`
        );
        if (!dryRun && kind === "extractor") {
          const eligible = eligibleDeadLetters;
          if (eligible > 0) {
            console.log(
              `${eligible} dead-letter entr${eligible === 1 ? "y is" : "ies are"} now eligible ` +
                `for retry — run 'sec extractor retry-dead-letters ${id}'`
            );
          }
        }
      });
    });

  // rollback
  version
    .command("rollback <kind> <id>")
    .description("Swap current and previous slots")
    .option("--notes <text>", "Optional notes for the audit log", "")
    .action(async (kind: string, id: string, options: Record<string, boolean | string>) => {
      await runCommand(async () => {
        assertComponentKind(kind);
        const notes =
          typeof options.notes === "string" && options.notes !== "" ? options.notes : null;
        const dryRun = parseGlobalOptions(program).dryRun;
        await runWorkflowCli<VersionRollbackTaskOutput>([
          new VersionRollbackTask({ defaults: { kind, id, notes, dryRun } }),
        ]);
        console.log(
          dryRun ? `(dry-run) rollback ${kind} ${id} would succeed` : `Rolled back ${kind}:${id}`
        );
      });
    });

  // drop-next
  version
    .command("drop-next <kind> <id>")
    .description("Discard the in-flight dev cycle (clear the next slot)")
    .option("--notes <text>", "Optional notes for the audit log", "")
    .action(async (kind: string, id: string, options: Record<string, boolean | string>) => {
      await runCommand(async () => {
        assertComponentKind(kind);
        const notes =
          typeof options.notes === "string" && options.notes !== "" ? options.notes : null;
        const dryRun = parseGlobalOptions(program).dryRun;
        await runWorkflowCli<VersionDropNextTaskOutput>([
          new VersionDropNextTask({ defaults: { kind, id, notes, dryRun } }),
        ]);
        console.log(
          dryRun
            ? `(dry-run) drop-next ${kind} ${id} would succeed`
            : `Dropped next slot for ${kind}:${id}`
        );
      });
    });

  // drop-previous
  version
    .command("drop-previous <kind> <id>")
    .description("Clear the previous slot and purge associated data")
    .option("--notes <text>", "Optional notes for the audit log", "")
    .action(async (kind: string, id: string, options: Record<string, boolean | string>) => {
      await runCommand(async () => {
        assertComponentKind(kind);
        const notes =
          typeof options.notes === "string" && options.notes !== "" ? options.notes : null;
        const dryRun = parseGlobalOptions(program).dryRun;
        await runWorkflowCli<VersionDropPreviousTaskOutput>([
          new VersionDropPreviousTask({ defaults: { kind, id, notes, dryRun } }),
        ]);
        console.log(
          dryRun
            ? `(dry-run) drop-previous ${kind} ${id} would succeed`
            : `Dropped previous slot for ${kind}:${id}`
        );
      });
    });
}
