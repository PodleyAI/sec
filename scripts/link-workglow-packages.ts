#!/usr/bin/env bun

import { $ } from "bun";
import fs from "node:fs";
import path from "node:path";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Packages to link for local Workglow development (see package.json).
 */
function getWorkglowLinkTargets(packageJsonPath: string): string[] {
  const packageJsonContent = fs.readFileSync(packageJsonPath, "utf8");
  const packageJson: PackageJson = JSON.parse(packageJsonContent);

  const packages: string[] = [];

  const consider = (deps: Record<string, string> | undefined): void => {
    if (!deps) {
      return;
    }
    for (const name of Object.keys(deps)) {
      if (name === "workglow" || name.startsWith("@workglow/")) {
        packages.push(name);
      }
    }
  };

  consider(packageJson.dependencies);
  consider(packageJson.devDependencies);

  return [...new Set(packages)].sort();
}

async function main(): Promise<void> {
  const packageJsonPath = path.join(process.cwd(), "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    console.error(`Error: package.json not found at ${packageJsonPath}`);
    process.exit(1);
  }

  const packages = getWorkglowLinkTargets(packageJsonPath);

  if (packages.length === 0) {
    console.log('No "workglow" or @workglow/* packages found in package.json');
    return;
  }

  console.log(`Found ${packages.length} Workglow package(s) to link:`);
  packages.forEach((pkg) => console.log(`  - ${pkg}`));
  console.log();

  const viteCacheDir = path.join(process.cwd(), "node_modules", ".vite");
  if (fs.existsSync(viteCacheDir)) {
    fs.rmSync(viteCacheDir, { recursive: true });
    console.log("Removed Vite cache (node_modules/.vite)");
    console.log();
  }

  try {
    await $`bun link ${packages}`;
    console.log(`✅ Successfully linked ${packages.length} package(s)`);
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
