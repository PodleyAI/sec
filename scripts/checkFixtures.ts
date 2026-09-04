#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Audits the committed EDGAR golden fixtures against their pinned manifest.
 *
 * A CI check on committed bytes, not something a user runs — which is why it is
 * a script and not a command. It reaches EDGAR over a plain fetch and writes
 * nothing, so it needs no configured database.
 *
 *   bun run check-fixtures            # verify, exit non-zero on any mismatch
 *   bun run check-fixtures --write    # re-download what no longer matches
 */
import { GoldenFixturesTask } from "../src/task/fixtures/GoldenFixturesTask";

const write = process.argv.includes("--write");
const force = process.argv.includes("--force");

const result = await new GoldenFixturesTask().run({
  mode: write ? "download" : "verify",
  force,
});

for (const problem of result.problems) console.error(problem);
console.log(`Done. ok=${result.ok} written=${result.written} failed=${result.failed}`);
if (result.failed > 0) {
  console.error(
    `${result.failed} fixture(s) no longer match the manifest. ` +
      "Re-run with --write once you have confirmed the change is intended."
  );
  process.exit(1);
}
