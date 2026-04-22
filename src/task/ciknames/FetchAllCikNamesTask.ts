/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { DataPortSchemaObject, IExecuteContext, Task, TaskAbortedError } from "workglow";
import { SecCachedFetchTask } from "../../fetch/SecCachedFetchTask";
import { SecFetchTask } from "../../fetch/SecFetchTask";
import { getDb } from "../../util/db";
import { TypeSecDate } from "../../util/parseDate";

// NOTE: cik names are mutable, so we use date to break the cache

const FetchAllCikNamesTaskInputSchema = () =>
  Type.Object({
    date: Type.Optional(TypeSecDate()),
  });

const FetchAllCikNamesTaskOutputSchema = () =>
  Type.Object({
    success: Type.Boolean(),
    count: Type.Integer(),
  });

export type FetchAllCikNamesTaskInput = Static<ReturnType<typeof FetchAllCikNamesTaskInputSchema>>;
export type FetchAllCikNamesTaskOutput = Static<
  ReturnType<typeof FetchAllCikNamesTaskOutputSchema>
>;

export class SecFetchCikLookupTask extends SecCachedFetchTask<
  FetchAllCikNamesTaskInput,
  FetchAllCikNamesTaskOutput
> {
  static readonly type = "SecFetchCikLookupTask";
  static readonly category = "Hidden";
  static readonly immutable = true;

  public static inputSchema() {
    return FetchAllCikNamesTaskInputSchema() as DataPortSchemaObject;
  }

  inputToFileName(input: FetchAllCikNamesTaskInput): string {
    return `cik-lookup-data.txt`;
  }

  inputToUrl(input: FetchAllCikNamesTaskInput): string {
    const date = input.date || new Date().toISOString().split("T")[0];
    return `https://www.sec.gov/Archives/edgar/cik-lookup-data.txt${date ? `?date=${date}` : ""}`;
  }
}

/**
 * Size of each progress/transaction batch when writing parsed CIK/name rows.
 * The SEC cik-lookup-data.txt feed is ~1M rows; we stream it through a single
 * prepared `INSERT OR REPLACE` inside a sqlite transaction, chunked so progress
 * can be reported and the event loop can breathe between commits.
 */
const BATCH_SIZE = 50_000;

/**
 * Parses one `NAME:CIK:` line from the SEC cik-lookup-data.txt feed.
 * Returns null for unparseable lines (e.g. blanks or entries without a CIK).
 */
function parseCikLine(line: string): { cik: number; name: string } | null {
  const lastColon = line.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const colonIndex = line.lastIndexOf(":", lastColon - 1);
  if (colonIndex < 0) return null;
  const name = line.substring(0, colonIndex).trim();
  const cikRaw = line.substring(colonIndex + 1, lastColon).trim();
  if (!cikRaw) return null;
  const cik = Number(cikRaw);
  if (!Number.isFinite(cik) || cik <= 0) return null;
  return { cik, name: name || "?" };
}

export class FetchAllCikNamesTask extends Task<
  FetchAllCikNamesTaskInput,
  FetchAllCikNamesTaskOutput
> {
  static readonly type = "FetchAllCikNamesTask";
  static readonly category = "SEC";
  static readonly cacheable = false;
  static readonly compoundMerge = "last";

  public static inputSchema() {
    return FetchAllCikNamesTaskInputSchema() as DataPortSchemaObject;
  }

  public static outputSchema() {
    return FetchAllCikNamesTaskOutputSchema() as DataPortSchemaObject;
  }

  async execute(
    input: FetchAllCikNamesTaskInput,
    context: IExecuteContext
  ): Promise<FetchAllCikNamesTaskOutput> {
    const secFetch = context.own(
      new SecFetchTask({
        url: `https://www.sec.gov/Archives/edgar/cik-lookup-data.txt${
          input.date ? `?date=${input.date}` : ""
        }`,
        response_type: "text",
      })
    );
    const secData = await secFetch.run();
    const secText = secData.text!;
    const lines = secText.split("\n");
    const totalLines = lines.length;

    // The SqliteTabularStorage `putBulk` path does one prepared statement and one
    // event emit per row, which is untenable for ~1M rows. We use the underlying
    // sqlite handle to run a single prepared `INSERT OR REPLACE` inside a
    // transaction per batch, which is ~100x faster and keeps the UI responsive.
    const db = getDb();
    const stmt = db.prepare<[number, string], unknown>(
      "INSERT OR REPLACE INTO `cik_names` (`cik`, `name`) VALUES (?, ?)"
    );
    const insertBatch = db.transaction((rows: ReadonlyArray<{ cik: number; name: string }>) => {
      for (const row of rows) {
        stmt.run(row.cik, row.name);
      }
    });

    let batch: { cik: number; name: string }[] = [];
    let totalStored = 0;
    let lastReportedProgress = -1;

    const flush = (): void => {
      if (batch.length === 0) return;
      insertBatch(batch);
      totalStored += batch.length;
      batch = [];
    };

    for (let i = 0; i < totalLines; i++) {
      if (context.signal.aborted) {
        throw new TaskAbortedError();
      }
      const parsed = parseCikLine(lines[i]);
      if (parsed !== null) {
        batch.push(parsed);
        if (batch.length >= BATCH_SIZE) {
          flush();
          // Yield to the event loop so the CLI progress UI can repaint and any
          // pending abort signal is observed promptly.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }

      const newProgress = Math.floor((i / totalLines) * 100);
      if (newProgress > lastReportedProgress) {
        context.updateProgress(newProgress, `stored ${totalStored} rows`);
        lastReportedProgress = newProgress;
      }
    }
    flush();
    context.updateProgress(100, `stored ${totalStored} rows`);

    return { success: true, count: totalStored };
  }
}
