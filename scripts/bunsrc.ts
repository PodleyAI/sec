#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Switch this package between source and built code while bun-linked into a
 * consumer (e.g. embarc-data), so edits are picked up without a rebuild.
 *
 *   bun run use-source            # dist/* re-exports src/*, incl. the `sec` bin
 *   bun run use-dist              # remove stubs and rebuild
 *   bun run use-dist --no-build   # remove stubs only
 *
 * `package.json` is never modified: source mode only writes into the gitignored
 * `dist` folder, so `git status` stays clean in either mode.
 *
 * Adapted from the libs monorepo's scripts/bunsrc-workspace.ts, scoped to this
 * single package instead of iterating workspaces.
 */
import { $ } from "bun";
import {
  readPackageManifest,
  removeSourceStubs,
  stubSpecsFor,
  writeSourceStubs,
} from "./sourceStubs";

const packageDir = process.cwd();

async function useSource(): Promise<void> {
  const manifest = await readPackageManifest(packageDir);
  const specs = stubSpecsFor(manifest);
  if (specs.length === 0) {
    console.log("No dist entry points to stub.");
    return;
  }
  const written = await writeSourceStubs(packageDir, specs);
  for (const target of written) console.log(`  ${target}`);
  console.log(`\nWrote ${written.length} stub(s). Imports and the sec bin now hit src/.`);
}

async function useDist(build: boolean): Promise<void> {
  const removed = await removeSourceStubs(packageDir);
  // No stubs is not a reason to skip the rebuild. `dist/` is gitignored, so the
  // common way to reach this state is having deleted it — and returning early
  // left the developer with the message "already in dist mode" and no dist at
  // all, with nothing saying why the build never ran.
  if (removed.length === 0) {
    console.log("No stubs found — already in dist mode.");
  } else {
    console.log(`Removed ${removed.length} stub(s).`);
  }

  if (!build) {
    console.log("Skipping rebuild (--no-build): dist is missing its entry files until you build.");
    return;
  }
  console.log("Rebuilding...\n");
  await $`bun run build`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const build = !args.includes("--no-build");
  const mode = args.find((arg) => !arg.startsWith("--"));

  if (mode !== "source" && mode !== "dist") {
    console.error("Usage: bun run scripts/bunsrc.ts <source|dist> [--no-build]");
    console.error("  source: dist/* re-exports src/* — development / bun link");
    console.error("  dist:   remove stubs and rebuild — committed / published state");
    process.exit(1);
  }

  if (mode === "source") {
    await useSource();
  } else {
    await useDist(build);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
