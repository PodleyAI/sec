/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globalServiceRegistry } from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { SEC_DB_FOLDER, SEC_RAW_DATA_FOLDER } from "../config/tokens";
import type { PersonRole } from "../storage/canonical/PersonRoleSchema";

/** Folder name under the resolved base directory. */
const SNAPSHOT_FOLDER = ".sec-snapshots";

/**
 * Where a snapshot lands: beside the database when a folder is configured for
 * one, else beside the raw data, else the working directory. Every one of
 * those is a place an operator already keeps this deployment's files, so the
 * file is findable by someone who knows nothing about this code — which is the
 * only property that makes a snapshot worth writing.
 */
export function personRoleSnapshotDir(): string {
  const base = globalServiceRegistry.has(SEC_DB_FOLDER)
    ? globalServiceRegistry.get(SEC_DB_FOLDER)
    : globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)
      ? globalServiceRegistry.get(SEC_RAW_DATA_FOLDER)
      : process.cwd();
  return path.join(base, SNAPSHOT_FOLDER);
}

/** Filesystem-safe rendering of a value that goes into a file name. */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Writes one resolver version's `person_role` rows to a file, as the undo for
 * a purge that is about to run.
 *
 * **A file, not a side table.** The rows are needed precisely when the table
 * they came from has just been emptied, so keeping the copy in another table
 * of the same database puts the backup behind the same purge, the same failed
 * migration and the same `db reset` as the original. A file also stays outside
 * the schema: nothing has to add it to the storage registry, teach
 * `dropPrevious` to prune it, or count it in `db stats` — and an operator
 * prunes it by deleting a file whose name says what it holds, rather than by
 * discovering a table that has been growing one generation per rebuild since
 * nobody wrote the pruning half.
 *
 * One NDJSON row per tenure, complete (`role_id` and `created_at` included), so
 * the file is the whole of what was deleted and can be read by anything that
 * reads lines. The version and the wall clock are in the FILE NAME rather than
 * in a header record, so a reader never has to skip a line that is not a row.
 *
 * Returns the path written, or undefined when there was nothing to snapshot or
 * the run is a dry run (whose purge deletes nothing, so there is nothing to
 * undo and a real file would be the one side effect a dry run promised not to
 * have).
 */
export async function writePersonRoleSnapshot(
  resolver_version: string,
  rows: readonly PersonRole[]
): Promise<string | undefined> {
  if (rows.length === 0) return undefined;
  if (isDryRun()) return undefined;
  const dir = personRoleSnapshotDir();
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `person_role-${slug(resolver_version)}-${slug(stamp)}.ndjson`);
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  // stderr, and at write time: the path is only useful to someone reading the
  // output of the run that is about to delete the rows it names.
  console.warn(`person_role snapshot: ${rows.length} row(s) written to ${file}`);
  return file;
}
