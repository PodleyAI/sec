#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Links every workglow / `@workglow/*` package this repo resolves at runtime to
 * its local `libs` checkout, so edits there take effect here without a publish.
 *
 * The set is the packages actually INSTALLED under `node_modules` intersected
 * with the ones `libs` provides as workspaces — NOT this repo's declared
 * dependencies. Most `@workglow/*` packages arrive transitively (this repo
 * declares two; more than that resolve here), so keying off `package.json`
 * left the rest pinned to registry copies. That is invisible until a fix edited
 * in `libs` fails to change behavior here.
 *
 * Intersecting with the installed set (rather than linking everything `libs`
 * has) keeps this from introducing packages this repo does not depend on.
 */
import fs from "node:fs";
import path from "node:path";
import { $ } from "bun";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const LIBS_ROOT = path.resolve(REPO_ROOT, "../libs");

/** Whether a package name belongs to the workglow family. */
function isWorkglowPackage(name: string): boolean {
  return name === "workglow" || name.startsWith("@workglow/");
}

/**
 * Every workglow package `libs` provides, as `name -> directory`, discovered
 * through its `workspaces` globs so a new package needs no edit here. Only the
 * single-`*` form libs uses is supported; anything else is reported rather than
 * silently contributing nothing.
 */
function localLibsPackages(): Map<string, string> {
  const libsPackageJson = path.join(LIBS_ROOT, "package.json");
  if (!fs.existsSync(libsPackageJson)) {
    throw new Error(`libs package.json not found at ${libsPackageJson} (expected sibling ../libs)`);
  }
  const { workspaces } = JSON.parse(fs.readFileSync(libsPackageJson, "utf8")) as {
    workspaces?: string[];
  };
  if (!workspaces || workspaces.length === 0) {
    throw new Error(`no "workspaces" declared in ${libsPackageJson}`);
  }

  const found = new Map<string, string>();
  for (const glob of workspaces) {
    if (!glob.endsWith("/*")) {
      console.warn(`  ! unsupported workspace glob '${glob}' — skipped`);
      continue;
    }
    const parent = path.resolve(LIBS_ROOT, glob.slice(0, -2));
    if (!fs.existsSync(parent)) continue;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(parent, entry.name, "package.json");
      if (!fs.existsSync(manifest)) continue;
      const { name } = JSON.parse(fs.readFileSync(manifest, "utf8")) as { name?: string };
      if (name && isWorkglowPackage(name)) found.set(name, path.join(parent, entry.name));
    }
  }
  return found;
}

/**
 * Every workglow package present in this repo's `node_modules` — the ground
 * truth for what this repo can actually load, including transitive arrivals.
 */
function installedWorkglowPackages(): string[] {
  const nodeModules = path.join(REPO_ROOT, "node_modules");
  if (!fs.existsSync(nodeModules)) {
    throw new Error(`node_modules not found at ${nodeModules} — run \`bun install\` first`);
  }

  const names: string[] = [];
  if (fs.existsSync(path.join(nodeModules, "workglow"))) names.push("workglow");

  const scoped = path.join(nodeModules, "@workglow");
  if (fs.existsSync(scoped)) {
    for (const entry of fs.readdirSync(scoped, { withFileTypes: true })) {
      // Symlinks count: an already-linked package must stay in the set, or
      // re-running this script would quietly drop it.
      if (entry.isDirectory() || entry.isSymbolicLink()) names.push(`@workglow/${entry.name}`);
    }
  }
  return [...new Set(names)].sort();
}

/**
 * Whether `name` already resolves to its local libs checkout.
 *
 * Compares RESOLVED paths rather than asking whether the entry is a symlink: a
 * routine `bun install` also installs packages as symlinks (into
 * `node_modules/.bun/<pkg>@<version>/…`), so "is a symlink" is true for
 * registry copies too and would report every package as already linked — hiding
 * exactly the packages this script exists to find.
 */
function resolvesToLocal(name: string, localDir: string): boolean {
  try {
    return (
      fs.realpathSync(path.join(REPO_ROOT, "node_modules", name)) === fs.realpathSync(localDir)
    );
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  // Linking rewrites node_modules symlinks, which is disruptive to anything
  // running out of this checkout. `--dry-run` reports the set, changing nothing.
  const dryRun = process.argv.includes("--dry-run");

  const local = localLibsPackages();
  const installed = installedWorkglowPackages();

  const linkable = installed.filter((name) => local.has(name));
  const notLocal = installed.filter((name) => !local.has(name));

  if (linkable.length === 0) {
    console.log("No installed workglow packages have a local libs counterpart — nothing to link.");
    return;
  }

  const stale = linkable.filter((pkg) => !resolvesToLocal(pkg, local.get(pkg) as string));

  console.log(
    `${dryRun ? "Would link" : "Linking"} ${linkable.length} package(s) to local source:`
  );
  for (const pkg of linkable) {
    const linked = resolvesToLocal(pkg, local.get(pkg) as string);
    console.log(`  - ${pkg}${linked ? " (already linked)" : "  <-- on a registry copy"}`);
  }
  if (stale.length > 0) {
    console.log(
      `\n${stale.length} package(s) currently resolve to a registry copy — ` +
        `local edits to them do NOT take effect here until this runs.`
    );
  }

  if (notLocal.length > 0) {
    // Named rather than counted: these are precisely the packages whose local
    // edits will NOT take effect here, which is the failure this script exists
    // to prevent, so it must not be silent about the ones it cannot cover.
    console.log(`\nInstalled but not a local libs workspace (left on the registry copy):`);
    for (const pkg of notLocal) console.log(`  - ${pkg}`);
  }

  if (dryRun) {
    console.log(`\n(dry run) Nothing was linked.`);
    return;
  }

  const viteCacheDir = path.join(REPO_ROOT, "node_modules", ".vite");
  if (fs.existsSync(viteCacheDir)) {
    fs.rmSync(viteCacheDir, { recursive: true });
    console.log("\nRemoved Vite cache (node_modules/.vite)");
  }

  try {
    await $`bun link ${linkable}`;
    console.log(`\n✅ Successfully linked ${linkable.length} package(s)`);
  } catch (error) {
    console.error(
      "❌ Failed to link packages:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
