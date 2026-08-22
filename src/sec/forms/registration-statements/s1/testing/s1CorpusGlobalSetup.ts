/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Names the run-scoped directory {@link loadS1Corpus} caches into. */
export const S1_CORPUS_CACHE_DIR_ENV = "SEC_S1_CORPUS_CACHE_DIR";

/**
 * Hands every test worker one directory to share a parsed S-1 corpus through.
 *
 * The ten `*.corpus.test.ts` files all read the same 42 committed fixtures, and
 * vitest runs each file in its own fork (`isolate: true`), so each one paid to
 * re-read and re-segment ~100 MB of HTML — the same work ten times over.
 *
 * This only creates the directory; nothing is parsed here. The first worker
 * that actually needs the corpus builds it and writes it, and the rest read it
 * back, so a single-file run of an unrelated test still pays nothing.
 *
 * **The cache is scoped to one vitest run, deliberately.** A cache that
 * outlived the run would have to invalidate whenever `parseEdgarHtml` or
 * `DocumentTreeSegmenter` changed, and there is no cheap, honest way to detect
 * that — the alternative is a corpus test quietly asserting against
 * segmentation the current code no longer produces, which is a worse failure
 * than a slow test. Scoping it to the run makes staleness impossible. It also
 * costs nothing in CI, where every run is a fresh checkout and a persistent
 * cache would never hit anyway.
 */
export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "sec-s1-corpus-"));
  process.env[S1_CORPUS_CACHE_DIR_ENV] = dir;
  return () => {
    delete process.env[S1_CORPUS_CACHE_DIR_ENV];
    rmSync(dir, { recursive: true, force: true });
  };
}
