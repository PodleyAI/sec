/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Type } from "typebox";
import type { IExecuteContext } from "workglow";
import { globalServiceRegistry, Task, TaskAbortedError } from "workglow";
import { advField, parseAdvCsv } from "../../sec/adv/parseAdvCsv";
import { ADV_ADVISER_REPOSITORY_TOKEN, type AdvAdviser } from "../../storage/adv/AdvAdviserSchema";
import { ADV_ROW_REPOSITORY_TOKEN, type AdvRow } from "../../storage/adv/AdvRowSchema";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { isDryRun } from "../../cli/isDryRun";
import type { TaskPorts } from "../taskPorts";

export interface IngestAdvSnapshotTaskInput {
  /** The period these CSVs describe, e.g. `2026-06`, stamped on every row. */
  readonly snapshot: string;
  /** Folder under `SEC_RAW_DATA_FOLDER` the archive was extracted into. */
  readonly folder?: string | undefined;
}

export interface IngestAdvSnapshotTaskOutput {
  readonly success: boolean;
  /** Archive members read. */
  readonly tables: number;
  /** Rows landed in `adv_row`. */
  readonly rows: number;
  /** Advisers landed in `adv_adviser`. */
  readonly advisers: number;
}

/**
 * SQLite binds one parameter per value and an ADV member runs to hundreds of
 * thousands of rows, so writes are chunked rather than handed over whole.
 */
const WRITE_BATCH = 500;

/**
 * The base-filing member, which is the one table lifted into typed columns.
 *
 * Matched on a substring because the archive ships the IA and ERA variants
 * under different names (`IA_ADV_Base_A`, `ERA_ADV_Base_A`, …) and has renamed
 * them between archives.
 */
function isBaseFilingMember(table: string): boolean {
  return /adv_base|base_filing/i.test(table);
}

/** Whether the member's name says it holds Exempt Reporting Advisers. */
function isEraMember(table: string): boolean {
  return /^era[_-]|_era_/i.test(table);
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** ISO date, or null — ADV dates arrive in several spellings across archives. */
function toIsoDate(value: string | undefined): string | null {
  if (value === undefined) return null;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash !== null) {
    const [, month, day, year] = slash as unknown as [string, string, string, string];
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/**
 * Lands one extracted Form ADV archive: every member as `adv_row`, and the
 * base-filing member additionally as typed `adv_adviser` rows.
 *
 * Nothing here knows the SEC's column set. The two headline tables people
 * filter on get columns; everything else stays queryable as JSON. A member the
 * SEC adds or renames lands with no code change.
 */
export class IngestAdvSnapshotTask extends Task<
  TaskPorts<IngestAdvSnapshotTaskInput>,
  TaskPorts<IngestAdvSnapshotTaskOutput>
> {
  static readonly type = "IngestAdvSnapshotTask";
  static readonly category = "SEC";
  static readonly title = "Ingest Form ADV snapshot";
  static readonly description = "Reads an extracted Form ADV archive into adv_adviser and adv_row.";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      snapshot: Type.String(),
      folder: Type.Optional(Type.String()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
      tables: Type.Integer(),
      rows: Type.Integer(),
      advisers: Type.Integer(),
    });
  }

  async execute(
    input: TaskPorts<IngestAdvSnapshotTaskInput>,
    context: IExecuteContext
  ): Promise<TaskPorts<IngestAdvSnapshotTaskOutput>> {
    const root = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const dir = join(root, input.folder ?? "adv");
    const members = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".csv")
      .map((entry) => entry.name)
      .sort();

    if (members.length === 0) {
      throw new Error(
        `No CSV members under ${dir}. Download the archive first: \`sec load download adv\`.`
      );
    }

    const rowRepo = globalServiceRegistry.get(ADV_ROW_REPOSITORY_TOKEN);
    const adviserRepo = globalServiceRegistry.get(ADV_ADVISER_REPOSITORY_TOKEN);
    const dryRun = isDryRun();

    let rowTotal = 0;
    let adviserTotal = 0;
    // Continues across members: `row_index` is part of the primary key, and a
    // per-member counter would have two members of one snapshot overwrite each
    // other's rows.
    let rowIndex = 0;

    for (const [position, member] of members.entries()) {
      if (context.signal?.aborted) throw new TaskAbortedError();
      const table = member.slice(0, -extname(member).length);
      await context.updateProgress(
        Math.floor((position / members.length) * 100),
        `${table} (${position + 1}/${members.length})`
      );

      const { rows } = parseAdvCsv(await readFile(join(dir, member), "utf-8"));
      const landed: AdvRow[] = rows.map((row) => ({
        snapshot: input.snapshot,
        table_name: table,
        row_index: rowIndex++,
        data: JSON.stringify(row),
      }));
      if (!dryRun) {
        for (let i = 0; i < landed.length; i += WRITE_BATCH) {
          await rowRepo.putBulk(landed.slice(i, i + WRITE_BATCH));
        }
      }
      rowTotal += landed.length;

      if (!isBaseFilingMember(table)) continue;
      const era = isEraMember(table);
      const advisers: AdvAdviser[] = [];
      for (const row of rows) {
        const crd = advField(row, "1E1", "CRD Number", "crd_number");
        if (crd === undefined) continue;
        advisers.push({
          snapshot: input.snapshot,
          crd_number: crd,
          sec_file_number: advField(row, "1D", "SEC File Number") ?? null,
          legal_name: advField(row, "1A", "Legal Name") ?? null,
          primary_business_name: advField(row, "1B1", "Primary Business Name") ?? null,
          is_era: era,
          main_office_city: advField(row, "1F1-City", "Main Office City") ?? null,
          main_office_state: advField(row, "1F1-State", "Main Office State") ?? null,
          main_office_country: advField(row, "1F1-Country", "Main Office Country") ?? null,
          regulatory_aum: toNumber(advField(row, "5F2c", "5F(2)(c)")),
          filing_id: advField(row, "FilingID") ?? null,
          date_submitted: toIsoDate(advField(row, "DateSubmitted", "Date Submitted")),
        });
      }
      if (!dryRun) {
        for (let i = 0; i < advisers.length; i += WRITE_BATCH) {
          await adviserRepo.putBulk(advisers.slice(i, i + WRITE_BATCH));
        }
      }
      adviserTotal += advisers.length;
    }

    return { success: true, tables: members.length, rows: rowTotal, advisers: adviserTotal };
  }
}
