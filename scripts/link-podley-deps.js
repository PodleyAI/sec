#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

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
    dep.startsWith("@podley/") ? `link:${dep}` : version,
  ])
);
packageJson.devDependencies = Object.fromEntries(
  Object.entries(packageJson.devDependencies).map(([dep, version]) => [
    dep,
    dep.startsWith("@podley/") ? `link:${dep}` : version,
  ])
);

writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
