/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import {
  COMPONENT_KINDS,
  COMPONENT_VERSION_REPOSITORY_TOKEN,
  ComponentKind,
} from "../../storage/versioning/ComponentVersionSchema";
import {
  dropNext as dropNextCeremony,
  promote as promoteCeremony,
  rollback as rollbackCeremony,
  startDev as startDevCeremony,
} from "../../storage/versioning/ceremonies";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { FORM_TO_EXTRACTOR_ID } from "../../storage/versioning/extractorIds";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "../../storage/versioning/VersionEventSchema";
import { VersionEventRepo } from "../../storage/versioning/VersionEventRepo";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { renderTable } from "../output/TableRenderer";
import { getVersionCoverage } from "../queries/VersionCoverage";
import { getVersionHistory } from "../queries/VersionHistory";
import { getVersionStatus } from "../queries/VersionStatus";
import { runCommand } from "../runCommand";

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

/**
 * For a major-bump start-dev, snapshot the count of filings handled by this
 * extractor. The result is stored on the next-slot row and acts as the
 * promote-gate denominator.
 */
async function snapshotTargetCount(extractorId: string): Promise<number> {
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const forms = Object.entries(FORM_TO_EXTRACTOR_ID)
    .filter(([, eid]) => eid === extractorId)
    .map(([form]) => form);
  let total = 0;
  for (const form of forms) {
    const rows = (await filingRepo.query({ form })) ?? [];
    total += rows.length;
  }
  return total;
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
        const rows = await getVersionStatus();

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
          throw new Error(
            `Invalid --limit '${options.limit}'. Expected positive integer.`
          );
        }
        const events = await getVersionHistory(kind, id, limit);
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
        const result = await getVersionCoverage(kind, id);
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
    .option("--dry-run", "Print what would happen; commit nothing", false)
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
          if (options.dryRun) {
            console.log(
              `(dry-run) start-dev ${kind} ${id} ${semver} --bump ${bumpArg}`
            );
            return;
          }
          const reg = new VersionRegistry(
            globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
          );
          const events = new VersionEventRepo(
            globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)
          );
          const targetCount =
            bumpArg === "major" ? await snapshotTargetCount(id) : null;
          const notes =
            typeof options.notes === "string" && options.notes !== ""
              ? options.notes
              : null;
          await startDevCeremony({
            reg,
            events,
            kind,
            id,
            semver,
            bump: bumpArg,
            targetCount,
            notes,
          });
          if (bumpArg === "patch") {
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
    .option("--dry-run", "Print what would happen; commit nothing", false)
    .action(
      async (kind: string, id: string, options: Record<string, boolean | string>) => {
        await runCommand(async () => {
          assertComponentKind(kind);
          if (options.dryRun) {
            console.log(`(dry-run) promote ${kind} ${id}`);
            return;
          }
          const reg = new VersionRegistry(
            globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
          );
          const events = new VersionEventRepo(
            globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)
          );
          const runs = new ExtractorRunRepo(
            globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
          );
          const notes =
            typeof options.notes === "string" && options.notes !== ""
              ? options.notes
              : null;
          await promoteCeremony({
            reg,
            events,
            runs,
            kind,
            id,
            force: options.force === true,
            notes,
          });
          console.log(`Promoted ${kind}:${id}`);
        });
      }
    );

  // rollback
  version
    .command("rollback <kind> <id>")
    .description("Swap current and previous slots")
    .option("--notes <text>", "Optional notes for the audit log", "")
    .option("--dry-run", "Print what would happen; commit nothing", false)
    .action(
      async (kind: string, id: string, options: Record<string, boolean | string>) => {
        await runCommand(async () => {
          assertComponentKind(kind);
          if (options.dryRun) {
            console.log(`(dry-run) rollback ${kind} ${id}`);
            return;
          }
          const reg = new VersionRegistry(
            globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
          );
          const events = new VersionEventRepo(
            globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)
          );
          const notes =
            typeof options.notes === "string" && options.notes !== ""
              ? options.notes
              : null;
          await rollbackCeremony({
            reg,
            events,
            kind,
            id,
            notes,
          });
          console.log(`Rolled back ${kind}:${id}`);
        });
      }
    );

  // drop-next
  version
    .command("drop-next <kind> <id>")
    .description("Discard the in-flight dev cycle (clear the next slot)")
    .option("--notes <text>", "Optional notes for the audit log", "")
    .option("--dry-run", "Print what would happen; commit nothing", false)
    .action(
      async (kind: string, id: string, options: Record<string, boolean | string>) => {
        await runCommand(async () => {
          assertComponentKind(kind);
          if (options.dryRun) {
            console.log(`(dry-run) drop-next ${kind} ${id}`);
            return;
          }
          const reg = new VersionRegistry(
            globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
          );
          const events = new VersionEventRepo(
            globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)
          );
          const notes =
            typeof options.notes === "string" && options.notes !== ""
              ? options.notes
              : null;
          await dropNextCeremony({
            reg,
            events,
            kind,
            id,
            notes,
          });
          console.log(`Dropped next slot for ${kind}:${id}`);
        });
      }
    );
}
