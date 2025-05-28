#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Get version from command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Error: Please provide a version number as an argument");
  console.error("Usage: ./scripts/set-podley-deps-to-version.js <version>");
  process.exit(1);
}

const podleyVersion = args[0];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json
const packageJsonPath = join(__dirname, "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

// Combine dependencies and devDependencies
const allDeps = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};

packageJson.dependencies = Object.fromEntries(
  Object.entries(packageJson.dependencies).map(([dep, version]) => [
    dep,
    dep.startsWith("@podley/") ? podleyVersion : version,
  ])
);
packageJson.devDependencies = Object.fromEntries(
  Object.entries(packageJson.devDependencies).map(([dep, version]) => [
    dep,
    dep.startsWith("@podley/") ? podleyVersion : version,
  ])
);

writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
