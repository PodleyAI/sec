/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";
import type { Form8KEvent, Form8KEventRepositoryStorage } from "./Form8KEventSchema";

export interface ReplaceForm8KEventsArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly events: ReadonlyArray<Omit<Form8KEvent, "event_id">>;
}

/**
 * Atomically delete + re-insert the events for one filing under one
 * extractor version. SQLite uses `better-sqlite3`'s `db.transaction`,
 * Postgres uses an explicit BEGIN/COMMIT on a checked-out client, and the
 * in-memory backend falls through to the repository — that backend is
 * synchronous and single-process so a torn write can't interleave with
 * another caller.
 */
export async function replaceForm8KEvents(
  repo: Form8KEventRepositoryStorage,
  args: ReplaceForm8KEventsArgs
): Promise<void> {
  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;

  // SEC_DB_TYPE lives in the global ServiceRegistry, which has no unregister
  // API — once any test (or production code path) registers it, it sticks
  // for the lifetime of the process. The test harness wires
  // FORM_8K_EVENT_REPOSITORY_TOKEN to an InMemoryTabularStorage but cannot
  // clear SEC_DB_TYPE, so dispatching on dbType alone would route writes
  // for the in-memory test repo into a real SQLite/Postgres backend that
  // was never set up. Trust the actual repo: when it is non-durable
  // (in-memory) take the repo path regardless of dbType.
  const isInMemoryRepo = typeof (repo as { isDurable?: () => boolean }).isDurable === "function"
    && (repo as { isDurable: () => boolean }).isDurable() === false;

  if (
    !isInMemoryRepo &&
    dbType === "sqlite" &&
    globalServiceRegistry.has(SEC_DB_FOLDER) &&
    globalServiceRegistry.has(SEC_DB_NAME)
  ) {
    return replaceSqlite(args);
  }
  if (!isInMemoryRepo && dbType === "postgres") {
    return replacePostgres(args);
  }
  return replaceRepository(repo, args);
}

function replaceSqlite(args: ReplaceForm8KEventsArgs): Promise<void> {
  const db = getDb();
  const delStmt = db.prepare<[number, string, string, string], unknown>(
    `DELETE FROM "form_8k_events" WHERE "cik" = ? AND "accession_number" = ? AND "extractor_id" = ? AND "extractor_version" = ?`
  );
  const insStmt = db.prepare<
    [number, string, string, string, string, string | null, string, string | null, number],
    unknown
  >(
    `INSERT INTO "form_8k_events"
      ("cik", "accession_number", "extractor_id", "extractor_version", "item_code", "item_description", "filing_date", "report_date", "is_amendment")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((events: ReadonlyArray<Omit<Form8KEvent, "event_id">>) => {
    delStmt.run(args.cik, args.accession_number, args.extractor_id, args.extractor_version);
    for (const e of events) {
      insStmt.run(
        e.cik,
        e.accession_number,
        e.extractor_id,
        e.extractor_version,
        e.item_code,
        e.item_description ?? null,
        e.filing_date,
        e.report_date ?? null,
        e.is_amendment ? 1 : 0
      );
    }
  });
  tx(args.events);
  return Promise.resolve();
}

async function replacePostgres(args: ReplaceForm8KEventsArgs): Promise<void> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM "form_8k_events" WHERE "cik" = $1 AND "accession_number" = $2 AND "extractor_id" = $3 AND "extractor_version" = $4`,
      [args.cik, args.accession_number, args.extractor_id, args.extractor_version]
    );
    for (const e of args.events) {
      await client.query(
        `INSERT INTO "form_8k_events"
          ("cik", "accession_number", "extractor_id", "extractor_version", "item_code", "item_description", "filing_date", "report_date", "is_amendment")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          e.cik,
          e.accession_number,
          e.extractor_id,
          e.extractor_version,
          e.item_code,
          e.item_description ?? null,
          e.filing_date,
          e.report_date ?? null,
          e.is_amendment,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore — the surfaced exception below is the meaningful one
    }
    throw e;
  } finally {
    client.release();
  }
}

async function replaceRepository(
  repo: Form8KEventRepositoryStorage,
  args: ReplaceForm8KEventsArgs
): Promise<void> {
  const existing = (await repo.query({
    cik: args.cik,
    accession_number: args.accession_number,
    extractor_id: args.extractor_id,
    extractor_version: args.extractor_version,
  } as any)) ?? [];
  for (const row of existing) {
    await repo.delete({ event_id: row.event_id } as any);
  }
  for (const e of args.events) {
    await repo.put(e as Form8KEvent);
  }
}
