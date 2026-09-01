/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { DataPortSchemaObject, IExecuteContext, Task, TaskAbortedError } from "workglow";
import { createCikNameBulkWriter } from "../../storage/entity/cikNameBulkWriter";
import { TypeSecDate } from "../../util/parseDate";
import { SecCachedFetchTask } from "../fetch/SecCachedFetchTask";
import { SecFetchTask } from "../fetch/SecFetchTask";

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
  static readonly title = "Download cik-lookup-data.txt";
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
  static readonly title = "Fetch all CIK names";
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
      new SecFetchTask(
        {
          url: `https://www.sec.gov/Archives/edgar/cik-lookup-data.txt${
            input.date ? `?date=${input.date}` : ""
          }`,
          response_type: "text",
        },
        { title: "Download cik-lookup-data.txt" }
      )
    );
    const secData = await secFetch.run();
    const secText = secData.text!;
    const lines = secText.split("\n");
    const totalLines = lines.length;

    // The generic `ITabularStorage.putBulk` path does one round-trip and one
    // event emit per row, which is untenable for the ~1M rows in this feed.
    // The bulk writer picks a backend-specific fast path: a single
    // `INSERT OR REPLACE` transaction for SQLite, multi-row parameterised
    // `INSERT ... ON CONFLICT` for Postgres. Tests fall back to the
    // repository's `putBulk` against the in-memory backend.
    //
    // The previous version reached into `getDb()` unconditionally, which
    // silently wrote rows into a SQLite file even when SEC_DB_TYPE=postgres.
    const writer = createCikNameBulkWriter();

    let batch: { cik: number; name: string }[] = [];
    let totalStored = 0;
    let lastReportedProgress = -1;

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      await writer.writeBatch(batch);
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
          await flush();
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
    try {
      await flush();
      context.updateProgress(100, `stored ${totalStored} rows`);
    } finally {
      await writer.close();
    }

    return { success: true, count: totalStored };
  }
}
