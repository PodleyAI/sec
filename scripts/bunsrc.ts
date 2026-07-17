#!/usr/bin/env bun

// Flip this package's `exports` between source (./src/*.ts) and built
// (./dist/*.js) files. Handy while bun-linked into a consumer (e.g. embarc-data):
// point exports at source so edits are picked up live without a rebuild/publish,
// then flip back to dist before committing / publishing.
//
// Adapted from the libs monorepo's scripts/bunsrc-workspace.ts, scoped to this
// single package instead of iterating workspaces.
//
//   bun run bunsrc-source   # use ./src/*.ts   (development, bun link)
//   bun run bunsrc-dist     # use ./dist/*.js  (committed / published state)

import { $ } from "bun";

function toSource(exports: string): string {
  return exports
    .replace(/("types":\s*")\.\/dist\/([^"]+)\.d\.ts"/g, `$1./src/$2.ts"`)
    .replace(
      /("(?:import|bun|node|browser|module|react-native|default)":\s*")\.\/dist\/([^"]+)\.js"/g,
      `$1./src/$2.ts"`
    );
}

function toDist(exports: string): string {
  return exports
    .replace(/("types":\s*")\.\/src\/([^"]+)\.ts"/g, `$1./dist/$2.d.ts"`)
    .replace(
      /("(?:import|bun|node|browser|module|react-native|default)":\s*")\.\/src\/([^"]+)\.ts"/g,
      `$1./dist/$2.js"`
    );
}

async function updateExports(mode: "source" | "dist"): Promise<void> {
  const exports = (await $`bun pm pkg get exports`.quiet()).text().trim();
  if (exports === "{}" || exports === "") {
    console.log("No exports field to update.");
    return;
  }
  const newExports = mode === "source" ? toSource(exports) : toDist(exports);
  if (newExports === exports) {
    console.log(`Exports already in ${mode} mode.`);
    return;
  }
  await $`bun pm pkg set exports=${newExports} --json`;
  console.log(`Exports switched to ${mode} mode.`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "source" && mode !== "dist") {
    console.error("Usage: bun run scripts/bunsrc.ts <source|dist>");
    console.error("  source: use source files (./src/*.ts) — development / bun link");
    console.error("  dist:   use built files (./dist/*.js) — committed / published");
    process.exit(1);
  }
  await updateExports(mode);
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
