#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fetch real SEC filing fixtures from EDGAR and write them under
 * src/sec/forms/exempt-offerings/mock_data/<form-slug>/.
 *
 * All HTTP work goes through this repository's own SEC fetch
 * infrastructure: FetchQuarterlyFormIdxTask reads the quarterly form-sorted
 * index (cached on disk under SEC_RAW_DATA_FOLDER), and individual
 * primary_doc.xml downloads run through SecFetchTask + SecJobQueueServer,
 * which already supplies:
 *
 *   - SEC_USER_AGENT header injection
 *   - 10 req/s rate limit + evenly-spaced limiter
 *   - Exponential backoff on 429/5xx
 *   - Retry-After honouring
 *   - Retryable vs permanent error classification
 *
 * The script's job is the small bit on top: pick accession numbers for
 * the requested form types, queue the fetches, and stash the responses in
 * the test fixture directory.
 *
 * Usage:
 *   bun scripts/fetch-fixtures.ts                          # defaults: known forms, ~50 each, last 2 quarters
 *   bun scripts/fetch-fixtures.ts --form D --count 100
 *   bun scripts/fetch-fixtures.ts --form "1-A POS" --quarter 2024Q4
 *   bun scripts/fetch-fixtures.ts --list                   # show what would be downloaded, no fetch
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { getTaskQueueRegistry, globalServiceRegistry } from "workglow";
import { SEC_RAW_DATA_FOLDER } from "../src/config/tokens";
import {
  SecJobQueueClient,
  SecJobQueueServer,
  SecJobQueueStorage,
} from "../src/fetch/SecJobQueue";
import { SecFetchAccessionDocTask } from "../src/task/forms/SecFetchAccessionDocTask";
import {
  FetchQuarterlyFormIdxTask,
  type QuarterlyFormIdxRow,
} from "../src/task/index/FetchQuarterlyFormIdxTask";

const MOCK_ROOT = resolve(import.meta.dir, "../src/sec/forms/exempt-offerings/mock_data");

// Forms with a parseable XML primary_doc.xml. Withdrawal-only forms like
// 1-A-W and 1-Z-W are filed as HTML-only and have no XML to parse, so they
// are intentionally excluded. C-W and C/A-W *do* use XML (the crowdfunding
// schema) and are included.
const FORM_SLUGS: Record<string, string> = {
  C: "form-c",
  "C/A": "form-c-a",
  "C-W": "form-c-w",
  "C/A-W": "form-c-a-w",
  D: "form-d",
  "D/A": "form-d-a",
  "1-A": "form-1-a",
  "1-A/A": "form-1-a-a",
  "1-A POS": "form-1-a-pos",
  "1-K": "form-1-k",
  "1-K/A": "form-1-k-a",
  "1-Z": "form-1-z",
  "1-Z/A": "form-1-z-a",
};

const DEFAULT_FORMS = Object.keys(FORM_SLUGS);
const DEFAULT_FIXTURE_COUNT = 50;

interface CliArgs {
  forms: readonly string[];
  count: number;
  quarters: readonly string[];
  list: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    forms: [...DEFAULT_FORMS],
    count: DEFAULT_FIXTURE_COUNT,
    quarters: defaultQuarters(),
    list: false,
  };
  const takeValue = (flag: string, i: number): string => {
    const value = argv[i];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--form") {
      args.forms = [takeValue(a, ++i)];
    } else if (a === "--forms") {
      args.forms = takeValue(a, ++i).split(",").map((s) => s.trim());
    } else if (a === "--count") {
      args.count = Number(takeValue(a, ++i));
    } else if (a === "--quarter") {
      args.quarters = [takeValue(a, ++i)];
    } else if (a === "--quarters") {
      args.quarters = takeValue(a, ++i).split(",").map((s) => s.trim());
    } else if (a === "--list") {
      args.list = true;
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  for (const f of args.forms) {
    if (!(f in FORM_SLUGS)) {
      throw new Error(
        `Unsupported form: "${f}". Known forms: ${Object.keys(FORM_SLUGS).join(", ")}`
      );
    }
  }
  for (const q of args.quarters) {
    if (!/^\d{4}Q[1-4]$/.test(q)) {
      throw new Error(`Quarter must look like 2025Q1, got: ${q}`);
    }
  }
  if (!Number.isFinite(args.count) || args.count <= 0) {
    throw new Error("--count must be a positive number");
  }
  return args;
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: bun scripts/fetch-fixtures.ts [options]",
      "",
      "Options:",
      "  --form <type>         single form type (e.g. D, 1-A, C-W)",
      "  --forms <a,b,c>       comma-separated form types",
      "  --count <N>           max fixtures to download per form (default 50)",
      "  --quarter <YYYYQn>    single quarter (e.g. 2025Q1)",
      "  --quarters <a,b,c>    comma-separated quarters (default: last 2 settled quarters)",
      "  --list                print accession numbers that would be fetched (no download)",
      "",
      "Rate limiting, retries, backoff, and User-Agent are handled by",
      "SecFetchJob/SecJobQueueServer -- no script-side tuning needed.",
      "",
      `Known forms: ${Object.keys(FORM_SLUGS).join(", ")}`,
      "",
    ].join("\n")
  );
}

function defaultQuarters(): string[] {
  // We pick a couple of settled quarters rather than the current one: the
  // form.idx for an in-progress quarter is partial and changes under us,
  // which would make fixture downloads non-deterministic.
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const currentQ = Math.floor(m / 3) + 1;
  const seq: Array<{ y: number; q: number }> = [];
  for (let back = 2; back <= 3; back++) {
    let qq = currentQ - back;
    let yy = y;
    while (qq <= 0) {
      qq += 4;
      yy -= 1;
    }
    seq.push({ y: yy, q: qq });
  }
  return seq.map(({ y, q }) => `${y}Q${q}`);
}

/**
 * Translate "2025Q1" into a date inside that quarter, as the
 * FetchQuarterlyFormIdxTask input expects a YYYY-MM-DD-style date and
 * derives the quarter from it.
 */
function quarterToDate(quarter: string): string {
  const [, year, q] = quarter.match(/^(\d{4})Q([1-4])$/) ?? [];
  const startMonth = (Number(q) - 1) * 3 + 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-15`;
}

export function accessionFromFileName(fileName: string): string {
  // "edgar/data/1959708/0001062993-25-001035.txt" -> "0001062993-25-001035"
  const base = fileName.split("/").pop() ?? "";
  return base.replace(/\.txt$/, "");
}

export function accessionWithoutDashes(accession: string): string {
  return accession.replace(/-/g, "");
}

export function fixturePath(formType: string, accession: string): string {
  const slug = FORM_SLUGS[formType];
  if (!slug) throw new Error(`No slug for form type ${formType}`);
  return join(MOCK_ROOT, slug, `${accessionWithoutDashes(accession)}-primary_doc.xml`);
}

function existingFixtureAccessions(formType: string): Set<string> {
  const slug = FORM_SLUGS[formType];
  const dir = join(MOCK_ROOT, slug);
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith("-primary_doc.xml"))
      .map((f) => f.replace("-primary_doc.xml", ""))
  );
}

interface FetchPlan {
  readonly formType: string;
  readonly toFetch: readonly QuarterlyFormIdxRow[];
  readonly skipped: number;
}

function buildPlan(
  rows: QuarterlyFormIdxRow[],
  formType: string,
  count: number
): FetchPlan {
  const existing = existingFixtureAccessions(formType);
  const candidates = rows.filter((r) => r.formType === formType);
  const fresh: QuarterlyFormIdxRow[] = [];
  let skipped = 0;
  for (const r of candidates) {
    const acc = accessionFromFileName(r.fileName);
    const accNoDashes = accessionWithoutDashes(acc);
    if (existing.has(accNoDashes)) {
      skipped++;
      continue;
    }
    fresh.push(r);
    if (fresh.length >= count) break;
  }
  return { formType, toFetch: fresh, skipped };
}

/**
 * Fetch a single primary_doc.xml through the SEC job queue. The queue
 * server handles rate limiting and retries; SecFetchAccessionDocTask also
 * persists each successful response under SEC_RAW_DATA_FOLDER (when set),
 * so re-running this script against the same accessions is free.
 * Returns null when SEC serves something that isn't an XML body (some
 * filings have no primary_doc.xml -- e.g. HTML-only withdrawal forms).
 */
async function fetchPrimaryDoc(row: QuarterlyFormIdxRow): Promise<string | null> {
  const acc = accessionFromFileName(row.fileName);
  const task = new SecFetchAccessionDocTask({
    cik: row.cik,
    accessionNumber: acc,
    fileName: "primary_doc.xml",
  });
  let result;
  try {
    result = await task.run();
  } catch (err) {
    process.stderr.write(
      `  ${row.formType} ${acc} -> error ${(err as Error).message}\n`
    );
    return null;
  }
  const text = result.text;
  if (!text) {
    process.stderr.write(`  ${row.formType} ${acc} -> empty response\n`);
    return null;
  }
  if (!text.trimStart().startsWith("<?xml")) {
    // EDGAR serves an HTML directory listing (or an error page) for
    // filings without a structured primary_doc.xml. Don't poison the
    // fixture set with HTML.
    process.stderr.write(`  ${row.formType} ${acc} -> non-XML body, skipping\n`);
    return null;
  }
  return text;
}

async function downloadPlan(plan: FetchPlan): Promise<{ ok: number; failed: number }> {
  const slug = FORM_SLUGS[plan.formType];
  const dir = join(MOCK_ROOT, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Run all fetches concurrently; SecJobQueueServer's rate limiter paces
  // them out at 10 req/s. Promise.allSettled keeps a single bad accession
  // from aborting the batch.
  const settled = await Promise.allSettled(
    plan.toFetch.map(async (row) => {
      const acc = accessionFromFileName(row.fileName);
      const target = fixturePath(plan.formType, acc);
      if (existsSync(target)) return { ok: true, acc };
      const body = await fetchPrimaryDoc(row);
      if (body === null) return { ok: false, acc };
      writeFileSync(target, body);
      return { ok: true, acc };
    })
  );

  let ok = 0;
  let failed = 0;
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value.ok) ok++;
    else failed++;
  }
  return { ok, failed };
}

let queueStarted = false;

async function ensureQueueStarted(): Promise<void> {
  if (queueStarted) return;
  // Pick up SEC_RAW_DATA_FOLDER if the user exported it -- enables the
  // SecCachedFetchTask disk cache so re-runs across the same quarter are
  // free. The CLI's full EnvToDI() also asserts DB config, which this
  // standalone script doesn't need, so we register just the one token.
  if (
    process.env.SEC_RAW_DATA_FOLDER &&
    !globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)
  ) {
    globalServiceRegistry.registerInstance(
      SEC_RAW_DATA_FOLDER,
      process.env.SEC_RAW_DATA_FOLDER
    );
  }
  // Register with the global registry the same way src/commands/index.ts
  // does at CLI boot. Without this, SecFetchTask.run() never gets serviced
  // by a worker.
  getTaskQueueRegistry().registerQueue({
    server: SecJobQueueServer,
    client: SecJobQueueClient,
    storage: SecJobQueueStorage,
  });
  await SecJobQueueServer.start();
  queueStarted = true;
}

async function stopQueue(): Promise<void> {
  if (!queueStarted) return;
  try {
    await SecJobQueueServer.stop();
  } catch (err) {
    // Stop errors are non-fatal -- the script is exiting anyway.
    process.stderr.write(`(warn) queue stop: ${(err as Error).message}\n`);
  }
  queueStarted = false;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await ensureQueueStarted();

  // Pull the form.idx for each requested quarter through the cached fetch
  // task. Subsequent runs in the same quarter are served from disk cache.
  const indexByQuarter = new Map<string, QuarterlyFormIdxRow[]>();
  for (const q of args.quarters) {
    process.stderr.write(`Fetching index ${q} ... `);
    const indexTask = new FetchQuarterlyFormIdxTask();
    const { rows } = await indexTask.run({ date: quarterToDate(q) });
    process.stderr.write(`${rows.length} rows\n`);
    indexByQuarter.set(q, rows);
  }

  let totalOk = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const formType of args.forms) {
    // Combine rows across all requested quarters, dedupe by accession.
    const combined: QuarterlyFormIdxRow[] = [];
    const seen = new Set<string>();
    for (const q of args.quarters) {
      for (const r of indexByQuarter.get(q) ?? []) {
        const acc = accessionFromFileName(r.fileName);
        if (seen.has(acc)) continue;
        seen.add(acc);
        combined.push(r);
      }
    }
    const plan = buildPlan(combined, formType, args.count);
    process.stderr.write(
      `Form ${formType}: ${plan.toFetch.length} to fetch, ${plan.skipped} already on disk\n`
    );
    if (args.list) {
      for (const r of plan.toFetch) {
        const acc = accessionFromFileName(r.fileName);
        process.stdout.write(`${formType}\t${r.cik}\t${acc}\t${r.companyName}\n`);
      }
      totalSkipped += plan.skipped;
      continue;
    }
    const { ok, failed } = await downloadPlan(plan);
    totalOk += ok;
    totalFailed += failed;
    totalSkipped += plan.skipped;
    process.stderr.write(`Form ${formType}: ok=${ok} failed=${failed}\n`);
  }

  process.stderr.write(
    `Done. downloaded=${totalOk} failed=${totalFailed} skipped=${totalSkipped}\n`
  );
}

if (import.meta.main) {
  main()
    .catch((err) => {
      process.stderr.write(`fetch-fixtures failed: ${err.message}\n`);
      process.exitCode = 1;
    })
    .finally(stopQueue);
}
