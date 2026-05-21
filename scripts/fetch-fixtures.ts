#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fetch real SEC filing fixtures from EDGAR full-index and write them under
 * src/sec/forms/exempt-offerings/mock_data/<form-slug>/. The tests in that
 * package read every XML file in those directories, so growing the fixture
 * set directly grows test coverage.
 *
 * Usage:
 *   bun scripts/fetch-fixtures.ts                # defaults: known forms, ~50 each, last 2 quarters
 *   bun scripts/fetch-fixtures.ts --form D --count 100
 *   bun scripts/fetch-fixtures.ts --form "1-A POS" --quarter 2024Q4
 *   bun scripts/fetch-fixtures.ts --list                # show what would be downloaded, no fetch
 *
 * The script is idempotent: it skips fixtures already present on disk. Honour
 * SEC fair-access: defaults to 8 req/s and exponential backoff on 429/5xx. Set
 * SEC_USER_AGENT in env so EDGAR doesn't 403.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { SecUserAgent } from "../src/config/Constants";

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

interface CliArgs {
  forms: string[];
  count: number;
  quarters: string[];
  list: boolean;
  rps: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    forms: [...DEFAULT_FORMS],
    count: 50,
    quarters: defaultQuarters(),
    list: false,
    rps: 8,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--form") {
      args.forms = [argv[++i]];
    } else if (a === "--forms") {
      args.forms = argv[++i].split(",").map((s) => s.trim());
    } else if (a === "--count") {
      args.count = Number(argv[++i]);
    } else if (a === "--quarter") {
      args.quarters = [argv[++i]];
    } else if (a === "--quarters") {
      args.quarters = argv[++i].split(",").map((s) => s.trim());
    } else if (a === "--rps") {
      args.rps = Number(argv[++i]);
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
      "  --quarters <a,b,c>    comma-separated quarters (default: last 2)",
      "  --rps <N>             max requests per second to SEC (default 8)",
      "  --list                print accession numbers that would be fetched",
      "",
      `Known forms: ${Object.keys(FORM_SLUGS).join(", ")}`,
      "",
    ].join("\n")
  );
}

function defaultQuarters(): string[] {
  // Pull from a couple of recent settled quarters. We avoid the current quarter
  // because the full-index for an in-progress quarter is partial and changes
  // under us; using older settled quarters keeps fixtures stable.
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  const currentQ = Math.floor(m / 3) + 1;
  const seq: Array<{ y: number; q: number }> = [];
  // Two quarters back, then three quarters back. (Most recent settled quarter
  // may have form types whose disclosure window hasn't closed.)
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

interface IndexRow {
  formType: string;
  companyName: string;
  cik: string;
  dateFiled: string;
  fileName: string; // e.g. "edgar/data/1959708/0001062993-25-001035.txt"
}

const HEADER_MARKER = "---";

export function parseFormIdx(content: string): IndexRow[] {
  // The form.idx is fixed-width with a header section then a divider line of
  // dashes. We split on the dashes line and then split each row on 2+ spaces,
  // which is reliable for the columns SEC publishes (no embedded double-space
  // sequences appear in real data, and trailing whitespace is OK).
  const lines = content.split(/\r?\n/);
  const divider = lines.findIndex((l) => l.startsWith(HEADER_MARKER));
  if (divider < 0) return [];

  const rows: IndexRow[] = [];
  for (let i = divider + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Split into max 5 columns; company names can contain commas but not 2+ spaces.
    const parts = line.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 5) continue;
    const [formType, companyName, cik, dateFiled, fileName] = parts;
    rows.push({ formType, companyName, cik, dateFiled, fileName });
  }
  return rows;
}

export function accessionFromFileName(fileName: string): string {
  // "edgar/data/1959708/0001062993-25-001035.txt" -> "0001062993-25-001035"
  const base = fileName.split("/").pop() ?? "";
  return base.replace(/\.txt$/, "");
}

export function accessionWithoutDashes(accession: string): string {
  return accession.replace(/-/g, "");
}

export function primaryDocUrl(cik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionWithoutDashes(accession)}/primary_doc.xml`;
}

export function fixturePath(formType: string, accession: string): string {
  const slug = FORM_SLUGS[formType];
  if (!slug) throw new Error(`No slug for form type ${formType}`);
  return join(MOCK_ROOT, slug, `${accessionWithoutDashes(accession)}-primary_doc.xml`);
}

async function fetchWithBackoff(url: string, attempt = 0): Promise<Response> {
  const maxAttempts = 5;
  const initialBackoff = 1_000;
  const maxBackoff = 30_000;
  const res = await fetch(url, {
    headers: { "User-Agent": SecUserAgent, "Accept-Encoding": "gzip, deflate" },
  });
  if (res.status === 200) return res;
  if (res.status === 404) return res; // permanent; caller decides
  if (attempt >= maxAttempts) return res;
  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    const backoff = Math.min(initialBackoff * 2 ** attempt, maxBackoff);
    await sleep(backoff);
    return fetchWithBackoff(url, attempt + 1);
  }
  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchIndex(quarter: string): Promise<IndexRow[]> {
  const match = quarter.match(/^(\d{4})Q([1-4])$/);
  if (!match) throw new Error(`Bad quarter ${quarter}`);
  const [, year, q] = match;
  const url = `https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${q}/form.idx`;
  process.stderr.write(`Fetching index ${quarter} ... `);
  const res = await fetchWithBackoff(url);
  if (!res.ok) {
    process.stderr.write(`FAILED (${res.status})\n`);
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const text = await res.text();
  const rows = parseFormIdx(text);
  process.stderr.write(`${rows.length} rows\n`);
  return rows;
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
  formType: string;
  toFetch: IndexRow[];
  skipped: number;
}

function buildPlan(rows: IndexRow[], formType: string, count: number): FetchPlan {
  const existing = existingFixtureAccessions(formType);
  const candidates = rows.filter((r) => r.formType === formType);
  const fresh: IndexRow[] = [];
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

async function downloadPlan(plan: FetchPlan, rps: number): Promise<{ ok: number; failed: number }> {
  const slug = FORM_SLUGS[plan.formType];
  const dir = join(MOCK_ROOT, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const minInterval = Math.max(1, Math.floor(1000 / Math.max(1, rps)));
  let ok = 0;
  let failed = 0;
  let lastTick = 0;
  for (const row of plan.toFetch) {
    const acc = accessionFromFileName(row.fileName);
    const target = fixturePath(plan.formType, acc);
    if (existsSync(target)) continue;

    const elapsed = Date.now() - lastTick;
    if (elapsed < minInterval) await sleep(minInterval - elapsed);
    lastTick = Date.now();

    const url = primaryDocUrl(row.cik, acc);
    try {
      const res = await fetchWithBackoff(url);
      if (!res.ok) {
        process.stderr.write(`  ${plan.formType} ${acc} -> HTTP ${res.status}\n`);
        failed++;
        continue;
      }
      const body = await res.text();
      // Sanity: every primary_doc.xml we care about starts with <?xml. SEC will
      // occasionally serve an HTML index page for filings without an XML primary
      // doc; we want to skip those rather than poison the fixtures.
      if (!body.trimStart().startsWith("<?xml")) {
        process.stderr.write(`  ${plan.formType} ${acc} -> non-XML body, skipping\n`);
        failed++;
        continue;
      }
      writeFileSync(target, body);
      ok++;
    } catch (err) {
      process.stderr.write(`  ${plan.formType} ${acc} -> error ${(err as Error).message}\n`);
      failed++;
    }
  }
  return { ok, failed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Collect rows from each quarter once, even if we run multiple forms.
  const indexByQuarter = new Map<string, IndexRow[]>();
  for (const q of args.quarters) {
    indexByQuarter.set(q, await fetchIndex(q));
  }

  let totalOk = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const formType of args.forms) {
    // Combine rows across all requested quarters, dedupe by accession.
    const combined: IndexRow[] = [];
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
    const { ok, failed } = await downloadPlan(plan, args.rps);
    totalOk += ok;
    totalFailed += failed;
    totalSkipped += plan.skipped;
    process.stderr.write(`Form ${formType}: ok=${ok} failed=${failed}\n`);
  }

  process.stderr.write(
    `Done. downloaded=${totalOk} failed=${totalFailed} skipped=${totalSkipped}\n`
  );
}

// Only invoke main when run directly (not when imported by tests).
if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(`fetch-fixtures failed: ${err.message}\n`);
    process.exit(1);
  });
}
