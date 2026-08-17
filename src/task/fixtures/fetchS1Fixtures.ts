/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Downloads a random sample of real SEC Form S-1 prospectus HTML for converter
 * testing — the "downloaded and cached" half of the S-1 fixtures story (the
 * smaller curated sample lives checked-in under
 * `src/sec/html/mock_data/s1/`; see that dir's SOURCES.md).
 *
 * Unlike exempt-offering fixtures (small `primary_doc.xml`), an S-1's primary
 * document is large narrative HTML, so this writes into a **gitignored** cache
 * directory by default rather than the checked-in tree.
 *
 * SPAC fixtures (blank-check companies, SIC **6770**) are guaranteed by a
 * minimum-SPAC floor in the otherwise-random selection.
 *
 * Network access is injected (`deps`) so the selection/planning logic is unit
 * tested without hitting EDGAR.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

export const DEFAULT_S1_SAMPLE_COUNT = 10;
export const DEFAULT_MIN_SPAC = 3;
/** SEC Standard Industrial Classification code for blank-check (SPAC) issuers. */
export const SPAC_SIC_CODE = "6770";

// Written output: keep it out of the source tree. `import.meta.dir` after
// bundling points at `dist/`, which would silently write into the packaged
// binary's directory — a `SEC_FIXTURES_DIR` override, else cwd, is stable
// regardless of how the CLI was launched.
const DEFAULT_CACHE_DIR = resolve(
  process.env.SEC_FIXTURES_DIR ?? process.cwd(),
  ".sec-fixtures/s1/.cache"
);

/** A candidate S-1 filing with the facts needed to select + fetch it. */
export interface S1Candidate {
  readonly cik: string;
  readonly accession: string; // dashed form, e.g. 0001193125-21-066104
  readonly companyName: string;
  readonly sicCode: string | undefined;
  readonly primaryDoc: string | undefined; // primary .htm filename
}

export function isSpac(c: Pick<S1Candidate, "sicCode">): boolean {
  return c.sicCode === SPAC_SIC_CODE;
}

/**
 * Pure selection: pick `count` fetchable candidates (those with a primary .htm),
 * guaranteeing at least `minSpac` SPACs. SPACs fill the floor first, then the
 * remainder is taken in the (already-shuffled) input order. Deterministic given
 * the input ordering — the caller shuffles for randomness.
 */
export function selectS1Sample(
  candidates: readonly S1Candidate[],
  count: number = DEFAULT_S1_SAMPLE_COUNT,
  minSpac: number = DEFAULT_MIN_SPAC
): S1Candidate[] {
  if (count <= 0) throw new Error("count must be positive");
  if (minSpac > count) throw new Error("minSpac cannot exceed count");

  const fetchable = candidates.filter((c) => c.primaryDoc !== undefined);
  const seen = new Set<string>();
  const dedup = fetchable.filter((c) => {
    if (seen.has(c.accession)) return false;
    seen.add(c.accession);
    return true;
  });

  const spacs = dedup.filter(isSpac);
  const rest = dedup.filter((c) => !isSpac(c));

  const chosen: S1Candidate[] = [];
  const take = (c: S1Candidate) => {
    if (chosen.length < count && !chosen.includes(c)) chosen.push(c);
  };

  // Meet the SPAC floor first.
  for (const c of spacs.slice(0, minSpac)) take(c);
  // Fill the rest from everything (non-SPACs first to maximize variety, then
  // any remaining SPACs), preserving input order.
  for (const c of rest) take(c);
  for (const c of spacs) take(c);

  return chosen;
}

export interface S1FixtureDeps {
  /** Returns recent S-1 candidates (cik/accession/companyName/sicCode/primaryDoc). */
  readonly listCandidates: () => Promise<readonly S1Candidate[]>;
  /** Fetches the primary-document HTML for a candidate. */
  readonly fetchHtml: (c: S1Candidate) => Promise<string>;
  readonly shuffle?: <T>(arr: readonly T[]) => T[];
  readonly log?: (msg: string) => void;
}

export interface FetchS1FixturesOptions {
  readonly count?: number;
  readonly minSpac?: number;
  readonly cacheDir?: string;
  readonly deps: S1FixtureDeps;
}

export interface FetchS1FixturesResult {
  readonly downloaded: number;
  readonly skipped: number;
  readonly spacs: number;
  readonly files: readonly string[];
}

function defaultShuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fixtureName(c: S1Candidate): string {
  return `s1_${c.cik}_${c.accession.replace(/-/g, "")}.htm`;
}

/** Download a SPAC-floored random S-1 sample into a (gitignored) cache directory. */
export async function fetchS1Fixtures(
  options: FetchS1FixturesOptions
): Promise<FetchS1FixturesResult> {
  const count = options.count ?? DEFAULT_S1_SAMPLE_COUNT;
  const minSpac = options.minSpac ?? DEFAULT_MIN_SPAC;
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const { deps } = options;
  const log = deps.log ?? ((m: string) => process.stderr.write(m + "\n"));
  const shuffle = deps.shuffle ?? defaultShuffle;

  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  console.log(`[sec fetch] output dir: ${cacheDir}`);

  log("Listing recent S-1 candidates ...");
  const candidates = await deps.listCandidates();
  const selection = selectS1Sample(shuffle(candidates), count, minSpac);
  log(
    `Selected ${selection.length} (${selection.filter(isSpac).length} SPAC) of ${candidates.length}`
  );

  const existing = new Set(readdirSync(cacheDir).filter((f) => f.endsWith(".htm")));
  const files: string[] = [];
  let downloaded = 0;
  let skipped = 0;

  for (const c of selection) {
    const name = fixtureName(c);
    files.push(name);
    if (existing.has(name)) {
      skipped++;
      continue;
    }
    try {
      const html = await deps.fetchHtml(c);
      writeFileSync(join(cacheDir, name), html);
      downloaded++;
      log(`  ${isSpac(c) ? "SPAC" : "    "} ${c.accession} ${c.companyName.slice(0, 32)}`);
    } catch (err) {
      log(`  ${c.accession} -> error ${(err as Error).message}`);
    }
  }

  return { downloaded, skipped, spacs: selection.filter(isSpac).length, files };
}
