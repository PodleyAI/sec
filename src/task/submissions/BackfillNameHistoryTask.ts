/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, TaskAbortedError } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import {
  ENTITY_HISTORY_REPOSITORY_TOKEN,
  type EntityHistory,
} from "../../storage/entity/EntityHistorySchema";
import { buildNameHistoryRows, NAME_HISTORY_CHANGE_SOURCE } from "./nameHistoryRows";

const CIK_FILE_PATTERN = /^CIK(\d+)\.json$/;

/** Rows buffered before a bulk write. Bounds memory across ~1M source files. */
const WRITE_BATCH = 5_000;

export type BackfillNameHistoryTaskInput = Record<string, never>;

export type BackfillNameHistoryTaskOutput = {
  readonly success: boolean;
  readonly ciksWithRenames: number;
  readonly rowsWritten: number;
};

/**
 * Populates `entities_history` from the cached bulk submissions.
 *
 * Ingest writes these rows as it goes (`StoreSubmissionNameHistoryTask`), so
 * this is the repair pass for data ingested before that existed: it reads
 * `formerNames` out of the already-downloaded JSON and replays it as temporal
 * rows, no network access required. Both paths share
 * {@link buildNameHistoryRows}, and the write is an upsert on
 * `(cik, valid_from)`, so re-running either is safe.
 *
 * Like the ingest writer, this reconciles: rows written under
 * {@link NAME_HISTORY_CHANGE_SOURCE} that the current `formerNames` no longer
 * produces are deleted, so a revised timeline cannot leave a second row with
 * `valid_to: null`. That reconcile is what a `force` flag would have been for,
 * so the task takes no options — every run rebuilds.
 *
 * The delete runs per renamed CIK inside the file loop while the writes stay
 * batched. That is one extra point query per *renamed* CIK — a small minority
 * of the ~1M files — against a loop that already pays a `readFile` plus a
 * `JSON.parse` for every one of them, so it is not the pass's cost centre.
 */
export class BackfillNameHistoryTask extends Task<
  BackfillNameHistoryTaskInput,
  BackfillNameHistoryTaskOutput
> {
  static readonly type = "BackfillNameHistoryTask";
  static readonly category = "SEC";
  static readonly title = "Backfill entity name history";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({});
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
      ciksWithRenames: Type.Integer(),
      rowsWritten: Type.Integer(),
    });
  }

  async execute(
    input: BackfillNameHistoryTaskInput,
    context: IExecuteContext
  ): Promise<BackfillNameHistoryTaskOutput> {
    const rawDataFolder = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const submissionsDir = resolve(rawDataFolder, "submissions");

    let files: string[];
    try {
      files = await readdir(submissionsDir);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(
          `Submissions directory not found: ${submissionsDir}. Run \`bootstrap download submissions\` first.`
        );
      }
      throw e;
    }

    if (isDryRun()) {
      console.log(`Would scan ${files.length} submission file(s) in ${submissionsDir}`);
      return { success: true, ciksWithRenames: 0, rowsWritten: 0 };
    }

    const repo = globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN);
    let pending: EntityHistory[] = [];
    let ciksWithRenames = 0;
    let rowsWritten = 0;
    let scanned = 0;

    for (const file of files) {
      if (context.signal?.aborted) throw new TaskAbortedError();

      const match = CIK_FILE_PATTERN.exec(file);
      if (!match) continue;
      scanned++;

      let submission: { name?: unknown; sic?: unknown; formerNames?: unknown };
      try {
        submission = JSON.parse(await readFile(resolve(submissionsDir, file), "utf8"));
      } catch {
        // A malformed or partially-extracted file shouldn't abort a ~1M-file
        // pass; the next bulk download replaces it.
        continue;
      }

      const cik = parseInt(match[1], 10);
      const rows = buildNameHistoryRows(cik, submission);
      if (rows.length === 0) continue;

      // Reconcile this CIK before buffering its rebuilt rows: drop any row a
      // previous pass wrote that the current `formerNames` no longer produces.
      // Scoped to this module's change source — `entities_history` is shared
      // with `EntityTemporalRepo.saveEntityWithHistory`, whose rows must
      // survive.
      const keep = new Set(rows.map((r) => r.valid_from));
      for (const existing of (await repo.query({ cik })) ?? []) {
        if (existing.change_source !== NAME_HISTORY_CHANGE_SOURCE) continue;
        if (keep.has(existing.valid_from)) continue;
        await repo.delete({ cik, valid_from: existing.valid_from });
      }

      ciksWithRenames++;
      pending.push(...rows);

      if (pending.length >= WRITE_BATCH) {
        await repo.putBulk(pending);
        rowsWritten += pending.length;
        pending = [];
        context.updateProgress(
          Math.floor((scanned / Math.max(files.length, 1)) * 100),
          `${ciksWithRenames} renamed CIK(s), ${rowsWritten} rows`
        );
      }
    }

    if (pending.length > 0) {
      await repo.putBulk(pending);
      rowsWritten += pending.length;
    }

    console.log(
      `Name history: ${rowsWritten} row(s) across ${ciksWithRenames} renamed CIK(s) from ${scanned} submission file(s).`
    );
    return { success: true, ciksWithRenames, rowsWritten };
  }
}
