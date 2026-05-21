/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import {
  COMPONENT_KINDS,
  COMPONENT_SLOTS,
  COMPONENT_VERSION_REPOSITORY_TOKEN,
  ComponentKind,
  ComponentSlot,
} from "../../storage/versioning/ComponentVersionSchema";
import {
  isValidSemver,
  VersionRegistry,
} from "../../storage/versioning/VersionRegistry";
import { renderTable } from "../output/TableRenderer";
import { getVersionStatus } from "../queries/VersionStatus";
import { runCommand } from "../runCommand";

function assertComponentKind(s: string): asserts s is ComponentKind {
  if (!(COMPONENT_KINDS as readonly string[]).includes(s)) {
    throw new Error(
      `Invalid component kind '${s}'. Expected one of: ${COMPONENT_KINDS.join(", ")}`
    );
  }
}

function assertComponentSlot(s: string): asserts s is ComponentSlot {
  if (!(COMPONENT_SLOTS as readonly string[]).includes(s)) {
    throw new Error(
      `Invalid slot '${s}'. Expected one of: ${COMPONENT_SLOTS.join(", ")}`
    );
  }
}

const SUPPORTED_STATUS_FORMATS = ["table", "json"] as const;

export function addVersionCommands(program: Command): void {
  const version = program
    .command("version")
    .description("Inspect and manage extractor/resolver versions");

  version
    .command("status")
    .description("Show the current/previous/next version of every component")
    .option("--format <format>", "Output format (table, json)", "table")
    .action(async (options: Record<string, string>) => {
      await runCommand(async () => {
        if (!(SUPPORTED_STATUS_FORMATS as readonly string[]).includes(options.format)) {
          throw new Error(
            `Invalid --format '${options.format}'. Expected one of: ${SUPPORTED_STATUS_FORMATS.join(", ")}`
          );
        }

        const rows = await getVersionStatus();

        if (options.format === "json") {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }

        if (rows.length === 0) {
          console.log("No components registered.");
          return;
        }

        // Decorate `next` for the table view only. JSON consumers get raw
        // semver in `next` plus the boolean `next_coverage_complete` flag.
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

  version
    .command("seed-test <kind> <id> <slot> <semver>")
    .description(
      "(internal) Write a single slot directly. PR3 replaces this with start-dev/promote."
    )
    .action(async (kind: string, id: string, slot: string, semver: string) => {
      await runCommand(async () => {
        assertComponentKind(kind);
        assertComponentSlot(slot);
        if (!isValidSemver(semver)) {
          throw new Error(`Invalid semver: ${semver}`);
        }
        const reg = new VersionRegistry(
          globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
        );
        await reg.putSlot({
          component_kind: kind,
          component_id: id,
          slot,
          semver,
          bump_type: null,
          started_at: new Date().toISOString(),
          coverage_complete: slot !== "next",
          target_count: null,
        });
        console.log(`Seeded ${kind}:${id} slot=${slot} semver=${semver}`);
      });
    });
}
