#!/usr/bin/env bun

import { $ } from "bun";
import fs from "node:fs";
import path from "node:path";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Extract all @workglow/* packages from package.json
 */
function getWorkglowPackages(packageJsonPath: string): string[] {
  const packageJsonContent = fs.readFileSync(packageJsonPath, "utf8");
  const packageJson: PackageJson = JSON.parse(packageJsonContent);

  const packages: string[] = [];

  // Check dependencies
  if (packageJson.dependencies) {
    for (const packageName of Object.keys(packageJson.dependencies)) {
      if (packageName.startsWith("@workglow/")) {
        packages.push(packageName);
      }
    }
  }

  // Check devDependencies
  if (packageJson.devDependencies) {
    for (const packageName of Object.keys(packageJson.devDependencies)) {
      if (packageName.startsWith("@workglow/")) {
        packages.push(packageName);
      }
    }
  }

  return packages.sort();
}

async function main(): Promise<void> {
  const packageJsonPath = path.join(process.cwd(), "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    console.error(`Error: package.json not found at ${packageJsonPath}`);
    process.exit(1);
  }

  const packages = getWorkglowPackages(packageJsonPath);

  if (packages.length === 0) {
    console.log("No @workglow/* packages found in package.json");
    return;
  }

  console.log(`Found ${packages.length} @workglow/* package(s) to link:`);
  packages.forEach((pkg) => console.log(`  - ${pkg}`));
  console.log();

  const viteCacheDir = path.join(process.cwd(), "node_modules", ".vite");
  if (fs.existsSync(viteCacheDir)) {
    fs.rmSync(viteCacheDir, { recursive: true });
    console.log("Removed Vite cache (node_modules/.vite)");
    console.log();
  }

  try {
    const result = await $`bun link ${packages}`;
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
