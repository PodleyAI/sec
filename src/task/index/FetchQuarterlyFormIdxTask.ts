/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { DataPortSchemaObject, IExecuteContext, Task, TaskAbortedError } from "workglow";
import { response_type, SecCachedFetchTask } from "../../fetch/SecCachedFetchTask";
import { parseDate, secDate, TypeOptionalSecDate, YYYYdMMdDD } from "../../util/parseDate";

/**
 * Quarterly form-sorted EDGAR index (`form.idx`). Same set of filings as
 * `master.idx` but ordered by form type, which makes form-specific
 * filtering trivial. Used by tooling (e.g. fixture downloading) and any
 * caller that needs the filing's form type and primary URL alongside the
 * CIK.
 *
 * The wire format is a fixed-width text file with a preamble and a
 * dashed divider, then one row per filing:
 *   "1-A    Algernon Neuroscience Inc.    1959708    2025-01-24    edgar/data/1959708/0001062993-25-001035.txt"
 *
 * `master.idx` -- which the sibling `FetchQuarterlyIndexTask` already
 * handles -- uses a pipe-delimited format and discards the filename.
 * form.idx is the right index for "find me filings of form X" workflows.
 */

export interface QuarterlyFormIdxRow {
  readonly formType: string;
  readonly companyName: string;
  readonly cik: number;
  readonly dateFiled: YYYYdMMdDD;
  readonly fileName: string;
}

export type FetchQuarterlyFormIdxTaskInput = {
  date: YYYYdMMdDD;
};

export type FetchQuarterlyFormIdxTaskOutput = {
  rows: QuarterlyFormIdxRow[];
};

/**
 * Inner cached fetcher. Lives behind the SEC job queue so callers get
 * automatic rate limiting (10 req/s plus an evenly-spaced limiter),
 * exponential backoff on 429/5xx, Retry-After handling, and the
 * configured SEC User-Agent. The fetched body is cached under
 * SEC_RAW_DATA_FOLDER so re-runs in the same quarter are free.
 */
class SecFetchQuarterlyFormIdxTask extends SecCachedFetchTask<FetchQuarterlyFormIdxTaskInput> {
  static readonly type = "SecFetchQuarterlyFormIdxTask";
  static readonly category = "Hidden";
  // Past-quarter form.idx files are immutable; the current quarter is not.
  // Tracking the parent's `immutable = false` keeps behaviour conservative
  // (the cache layer re-validates rather than serves stale text).
  static readonly immutable = false;

  response_type: response_type = "text";

  public static inputSchema(): DataPortSchemaObject {
    return Type.Object({
      date: TypeOptionalSecDate({
        title: "Date",
        description: "Any date inside the quarter to fetch (used to derive YYYY/QTRn).",
      }),
    }) as DataPortSchemaObject;
  }

  inputToFileName(input: FetchQuarterlyFormIdxTaskInput): string {
    const { year, month } = parseDate(input.date);
    const quarter = Math.ceil(parseInt(month) / 3);
    return `quarterly-index/${year}-QTR${quarter}.form.idx`;
  }

  inputToUrl(input: FetchQuarterlyFormIdxTaskInput): string {
    const { year, month } = parseDate(input.date);
    const quarter = Math.ceil(parseInt(month) / 3);
    return `https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${quarter}/form.idx`;
  }
}

const HEADER_DIVIDER_MARKER = "---";

/**
 * Parses the body of a `form.idx` file into an array of typed rows. Exported
 * for unit testing -- callers wanting parsed rows should use
 * `FetchQuarterlyFormIdxTask` so they pick up the cache+rate-limit path.
 *
 * The file is fixed-width but columns are separated by runs of 2+ spaces; no
 * 2-space sequence appears inside the company-name column in practice, so a
 * split-on-`/\s{2,}/` is reliable.
 */
export function parseQuarterlyFormIdx(content: string): QuarterlyFormIdxRow[] {
  const lines = content.split(/\r?\n/);
  const divider = lines.findIndex((l) => l.startsWith(HEADER_DIVIDER_MARKER));
  if (divider < 0) return [];

  const rows: QuarterlyFormIdxRow[] = [];
  for (let i = divider + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = line.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 5) continue;
    const [formType, companyName, cikStr, dateFiled, fileName] = parts;
    const cik = parseInt(cikStr, 10);
    if (!Number.isFinite(cik)) continue;
    rows.push({
      formType,
      companyName,
      cik,
      dateFiled: secDate(dateFiled),
      fileName,
    });
  }
  return rows;
}

/**
 * Public task: fetches a quarter's `form.idx` and yields parsed rows.
 * Mirrors the shape of `FetchQuarterlyIndexTask` so callers and CLI
 * surfaces can switch between master- and form-sorted indexes by name.
 */
export class FetchQuarterlyFormIdxTask extends Task<
  FetchQuarterlyFormIdxTaskInput,
  FetchQuarterlyFormIdxTaskOutput
> {
  static readonly type = "FetchQuarterlyFormIdxTask";
  static readonly category = "SEC";
  static readonly cacheable = true;

  public static inputSchema(): DataPortSchemaObject {
    return Type.Object({
      date: TypeOptionalSecDate({
        title: "Date",
        description: "Any date inside the quarter to fetch (used to derive YYYY/QTRn).",
      }),
    }) as DataPortSchemaObject;
  }

  public static outputSchema(): DataPortSchemaObject {
    return Type.Object({
      rows: Type.Array(
        Type.Object({
          formType: Type.String(),
          companyName: Type.String(),
          cik: Type.Number(),
          dateFiled: Type.String(),
          fileName: Type.String(),
        })
      ),
    }) as DataPortSchemaObject;
  }

  async execute(
    input: FetchQuarterlyFormIdxTaskInput,
    context: IExecuteContext
  ): Promise<FetchQuarterlyFormIdxTaskOutput> {
    const date = input.date ? secDate(input.date) : secDate(new Date());
    if (context.signal?.aborted) throw new TaskAbortedError();
    const secFetch = context.own(new SecFetchQuarterlyFormIdxTask({ date }));
    const secData = await secFetch.run();
    const text = secData.text ?? "";
    if (context.signal?.aborted) throw new TaskAbortedError();
    // form.idx is fixed-width (not pipe-delimited like master.idx), so the
    // task body parses it with a dedicated splitter.
    const rows = parseQuarterlyFormIdx(text);
    context.updateProgress(100, `parsed ${rows.length} rows`);
    return { rows };
  }
}
