/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "path";
import { Sqlite } from "workglow";

/**
 * Reads version state straight out of a test's database file.
 *
 * A CLI test spawns the binary to EXERCISE a command, which is the only way to
 * cover argv parsing, exit codes and rendered output. Observing what the
 * command did is a different question, and spending a second process on
 * `version status` to answer it costs another full boot and only ever proves
 * the state through a second command's rendering. Reading the rows says it
 * directly.
 *
 * `Sqlite` resolves to `bun:sqlite` or better-sqlite3 by export condition, so
 * this works under both `vitest` (Node) and `bun test`.
 */

const DB_FILE = "edgar.sqlite";

export interface ComponentSlots {
  readonly current: string | undefined;
  readonly previous: string | undefined;
  readonly next: string | undefined;
}

export interface VersionEventRow {
  readonly event_type: string;
  readonly from_semver: string | null;
  readonly to_semver: string | null;
  readonly notes: string | null;
}

async function withDb<T>(dbFolder: string, read: (db: Sqlite.Database) => T): Promise<T> {
  await Sqlite.init();
  const db = new Sqlite.Database(path.join(dbFolder, DB_FILE));
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/** The three version slots for one component; a slot with no row reads as undefined. */
export async function readComponentSlots(
  dbFolder: string,
  kind: string,
  id: string
): Promise<ComponentSlots> {
  const rows = await withDb(dbFolder, (db) =>
    db
      .prepare<[string, string], { slot: string; semver: string }>(
        "SELECT slot, semver FROM component_versions WHERE component_kind = ? AND component_id = ?"
      )
      .all(kind, id)
  );
  const bySlot = new Map(rows.map((r) => [r.slot, r.semver]));
  return {
    current: bySlot.get("current"),
    previous: bySlot.get("previous"),
    next: bySlot.get("next"),
  };
}

/** One component's version events, newest first — the order `version history` prints. */
export async function readComponentEvents(
  dbFolder: string,
  kind: string,
  id: string
): Promise<VersionEventRow[]> {
  return withDb(dbFolder, (db) =>
    db
      .prepare<[string, string], VersionEventRow>(
        "SELECT event_type, from_semver, to_semver, notes FROM version_events " +
          "WHERE component_kind = ? AND component_id = ? ORDER BY id DESC"
      )
      .all(kind, id)
  );
}
