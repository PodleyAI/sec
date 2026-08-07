#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Prepack safeguard: inspect what `bun publish` would ship and fail loudly if the
 * tarball is bloated or carries test / fixture data.
 *
 * PR #203 landed with `"src"` in `files` from an earlier revision even though the
 * intent-of-record was `files: ["dist"]`, and `bun publish` on 0.0.11 shipped the
 * whole 77 MB source tree — 267 `*.test.ts`, ~15 MB of committed EDGAR HTML
 * mock_data, and the golden-truth SPAC corpus. This script blocks a repeat.
 *
 * Strategy:
 *   1. Try `bun pm pack --dry-run --json` (bun currently ignores `--json` and
 *      emits its plain-text listing; the JSON.parse fails and we fall through).
 *   2. Try `npm pack --dry-run --json` — this returns a well-defined JSON shape
 *      with per-file `path` entries and `unpackedSize`.
 *   3. Last-resort fall back to `bun pm pack --dry-run` and grep the plain text
 *      for forbidden patterns so the safeguard still fires without npm.
 */

import { spawnSync } from "node:child_process";
import { findSourceStubs } from "./sourceStubs";

const MAX_UNPACKED_BYTES = 5_000_000; // 5 MB
const FORBIDDEN_SUFFIXES = [".test.ts"] as const;
const FORBIDDEN_PREFIXES = [
  "src/sec/html/mock_data/",
  "src/eval/mock_data/",
] as const;
const FORBIDDEN_SUBSTRINGS = ["/mock_data/"] as const;

interface PackReport {
  readonly source: string;
  readonly files: readonly string[];
  readonly unpackedSize: number | undefined;
}

interface CmdResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
}

function runCmd(command: string, args: readonly string[]): CmdResult {
  const proc = spawnSync(command, args as string[], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    status: proc.status,
  };
}

function tryParseJsonReport(source: string, stdout: string): PackReport | undefined {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    // npm returns [{ files: [{ path }], unpackedSize }]; some tools return the object directly.
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    if (root === null || typeof root !== "object") return undefined;
    const rec = root as Record<string, unknown>;
    const rawFiles = rec.files;
    if (!Array.isArray(rawFiles)) return undefined;
    const files: string[] = [];
    for (const entry of rawFiles) {
      if (typeof entry === "string") {
        files.push(entry);
      } else if (entry && typeof entry === "object" && "path" in entry) {
        const p = (entry as { path: unknown }).path;
        if (typeof p === "string") files.push(p);
      }
    }
    if (files.length === 0) return undefined;
    const size = typeof rec.unpackedSize === "number" ? rec.unpackedSize : undefined;
    return { source, files, unpackedSize: size };
  } catch {
    return undefined;
  }
}

function parseBunTextReport(source: string, output: string): PackReport {
  // `bun pm pack --dry-run` prints one `packed <size> <path>` line per file, then
  // a `Total files: N` and `Unpacked size: <human>` summary. Sizes come as
  // `1.23KB` / `10.93MB` / `230B` — parse both file list and the summary total.
  const files: string[] = [];
  let unpackedSize: number | undefined;

  const lines = output.split(/\r?\n/);
  const packedRe = /^packed\s+\S+\s+(.+?)\s*$/;
  const unpackedRe = /^Unpacked size:\s+([\d.]+)\s*([KMGT]?B)\s*$/i;

  for (const line of lines) {
    const m = line.match(packedRe);
    if (m) {
      files.push(m[1]);
      continue;
    }
    const u = line.match(unpackedRe);
    if (u) {
      const n = parseFloat(u[1]);
      const unit = u[2].toUpperCase();
      const mult =
        unit === "B" ? 1
          : unit === "KB" ? 1024
            : unit === "MB" ? 1024 ** 2
              : unit === "GB" ? 1024 ** 3
                : unit === "TB" ? 1024 ** 4
                  : 1;
      unpackedSize = Math.round(n * mult);
    }
  }
  return { source, files, unpackedSize };
}

function collectReport(): PackReport {
  // 1. bun pm pack --dry-run --json (best-effort; bun currently ignores --json).
  const bunJson = runCmd("bun", ["pm", "pack", "--dry-run", "--json"]);
  if (bunJson.status === 0) {
    const parsed = tryParseJsonReport("bun pm pack --json", bunJson.stdout);
    if (parsed) return parsed;
  }

  // 2. npm pack --dry-run --json (well-defined JSON shape).
  const npmJson = runCmd("npm", ["pack", "--dry-run", "--json"]);
  if (npmJson.status === 0) {
    const parsed = tryParseJsonReport("npm pack --json", npmJson.stdout);
    if (parsed) return parsed;
  }

  // 3. Fall back to bun's plain-text listing.
  const bunText = runCmd("bun", ["pm", "pack", "--dry-run"]);
  if (bunText.status !== 0) {
    throw new Error(
      `Could not get a tarball listing. ` +
        `bun pm pack exited ${bunText.status}. stderr:\n${bunText.stderr}`
    );
  }
  const combined = `${bunText.stdout}\n${bunText.stderr}`;
  return parseBunTextReport("bun pm pack (text)", combined);
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${n} B`;
}

function findForbidden(files: readonly string[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    if (FORBIDDEN_SUFFIXES.some((s) => f.endsWith(s))) {
      hits.push(f);
      continue;
    }
    if (FORBIDDEN_PREFIXES.some((p) => f.startsWith(p))) {
      hits.push(f);
      continue;
    }
    if (FORBIDDEN_SUBSTRINGS.some((s) => f.includes(s))) {
      hits.push(f);
      continue;
    }
  }
  return hits;
}

async function main(): Promise<void> {
  const report = collectReport();
  const violations: string[] = [];

  // Source mode leaves re-export stubs in dist that point at src/, which is not
  // shipped. The size ceiling below cannot catch this — a stubbed tarball is
  // small, not large.
  const stubs = await findSourceStubs(process.cwd());
  if (stubs.length > 0) {
    violations.push(
      `${stubs.length} source-mode stub(s) in dist — run \`bun run use-dist\` and rebuild:\n  ` +
        stubs.slice(0, 5).join("\n  ")
    );
  }

  const forbidden = findForbidden(report.files);
  if (forbidden.length > 0) {
    const sample = forbidden.slice(0, 10).join("\n  ");
    const extra = forbidden.length > 10 ? `\n  ... and ${forbidden.length - 10} more` : "";
    violations.push(
      `${forbidden.length} forbidden file(s) would be published ` +
        `(tests / mock_data are not part of the shipped package):\n  ${sample}${extra}`
    );
  }

  if (report.unpackedSize !== undefined && report.unpackedSize > MAX_UNPACKED_BYTES) {
    violations.push(
      `unpacked tarball size ${formatBytes(report.unpackedSize)} exceeds ` +
        `${formatBytes(MAX_UNPACKED_BYTES)} limit — the shipped package should be dist/ only`
    );
  }

  if (violations.length > 0) {
    console.error("prepack-check FAILED:");
    for (const v of violations) console.error(`  - ${v}`);
    // Only relevant to what the tarball contains; a stub violation is about
    // dist itself and has its own remedy in the message above.
    if (violations.length > (stubs.length > 0 ? 1 : 0)) {
      console.error(
        "\nCheck the `files` array in package.json — likely 'src' or a similar " +
          "path was re-added. Only 'dist' should ship."
      );
    }
    process.exit(1);
  }

  const sizeText = report.unpackedSize !== undefined ? formatBytes(report.unpackedSize) : "unknown";
  console.log(
    `prepack-check OK (${report.source}): ${report.files.length} file(s), unpacked ${sizeText}.`
  );
}

await main();
