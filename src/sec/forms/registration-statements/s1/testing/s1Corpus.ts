/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEdgarHtml } from "../../../../html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "../DocumentTreeSegmenter";
import { S1_CORPUS_CACHE_DIR_ENV } from "./s1CorpusGlobalSetup";

const MOCK_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../html/mock_data/s1"
);

export interface S1CorpusFiling {
  /** The fixture's basename with `.htm` stripped — the key golden labels use. */
  readonly filing: string;
  /** Every segmented section of that filing, by {@link S1_SECTIONS} name. */
  readonly byName: ReadonlyMap<string, string>;
}

/**
 * Budget for building the corpus, for the `beforeAll` that does it.
 *
 * Reading and segmenting 42 committed prospectuses is ~100 MB of HTML through
 * `parseEdgarHtml` plus a tree walk each, which is genuinely tens of seconds —
 * it is the work, not a hang. The suite-wide `testTimeout` is 30s, tuned for
 * the CLI integration tests that spawn `sec` subprocesses, and a slower CI
 * runner crosses it: the corpus build used to be charged lazily to whichever
 * `it()` touched it first, so CI failed on an assertion reading
 * `expect(cases().length).toBeGreaterThan(0)` — a test that does no work and
 * named nothing about what was slow.
 *
 * Doing it in `beforeAll` with its own budget puts the cost where it belongs
 * and leaves each test's own timeout tight enough to still catch a real hang.
 *
 * 120s matches the `CORPUS_PARSE_TIMEOUT_MS` the older corpus-reading tests in
 * `src/eval` already use for the same reason — those were written with an
 * explicit budget; these ten were not, which is the whole of this bug.
 */
export const S1_CORPUS_TIMEOUT_MS = 120_000;

let cached: readonly S1CorpusFiling[] | undefined;

/** `[filing, [[sectionName, text], ...]]` — a Map does not survive JSON. */
type SerializedCorpus = ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]>;

function segmentCorpus(): S1CorpusFiling[] {
  const out: S1CorpusFiling[] = [];
  for (const file of readdirSync(MOCK_DIR)
    .filter((f) => f.endsWith(".htm"))
    .sort()) {
    const doc = parseEdgarHtml(readFileSync(join(MOCK_DIR, file), "utf8"), file);
    const segmented = new DocumentTreeSegmenter().segment(doc);
    out.push({
      filing: file.replace(/\.htm$/, ""),
      byName: new Map(segmented.map((s) => [s.name as string, s.text])),
    });
  }
  return out;
}

/**
 * Every committed S-1 fixture, parsed and segmented.
 *
 * Memoized in-process, and — when the global setup provided a run-scoped
 * directory — shared across processes through it. Vitest runs each test file in
 * its own fork (`isolate: true`), so without that the ten `*.corpus.test.ts`
 * files each re-read and re-segment the same ~100 MB of HTML. Reading the cache
 * back is a JSON parse of ~19 MB, which is milliseconds against the seconds the
 * segmentation costs.
 *
 * A miss is never an error: with no cache directory (a bare `vitest` run of one
 * file, or any non-vitest caller) this simply segments, exactly as before.
 */
export function loadS1Corpus(): readonly S1CorpusFiling[] {
  if (cached !== undefined) return cached;
  const dir = process.env[S1_CORPUS_CACHE_DIR_ENV];
  const cacheFile = dir === undefined ? undefined : join(dir, "corpus.json");

  if (cacheFile !== undefined && existsSync(cacheFile)) {
    const rows = JSON.parse(readFileSync(cacheFile, "utf8")) as SerializedCorpus;
    cached = rows.map(([filing, entries]) => ({ filing, byName: new Map(entries) }));
    return cached;
  }

  const built = segmentCorpus();
  if (cacheFile !== undefined) {
    // Several forks can miss at once and all build; each writes its own temp
    // file and renames it over the target, so a reader never observes a partial
    // one and the duplicate work is bounded by however many raced.
    const serialized: SerializedCorpus = built.map((f) => [f.filing, [...f.byName]]);
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(serialized));
      renameSync(tmp, cacheFile);
    } catch {
      // A cache that cannot be written is a missed optimization, never a
      // failed test — the corpus in hand is already correct.
      rmSync(tmp, { force: true });
    }
  }
  cached = built;
  return cached;
}
