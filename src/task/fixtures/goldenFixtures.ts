/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reproduce and audit the committed golden fixture corpus described by
 * {@link GOLDEN_FIXTURES}.
 *
 * Two modes over the same manifest walk:
 *
 * - **download** — fetch each pinned EDGAR document, apply the capture
 *   transform, check the result against the manifest digest, and write it. A
 *   digest mismatch is never written to disk: a truncated response or an EDGAR
 *   error page silently replacing a fixture is exactly the failure that would
 *   otherwise surface as a baffling segmenter diff.
 * - **verify** — fetch and compare without writing, reporting separately
 *   whether the *remote* document changed or the *local* file was edited.
 *
 * Network access is injected so both modes are unit tested without EDGAR.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAsset } from "../../util/resolveAsset";
import type { GoldenFixtureEntry } from "./goldenFixtureManifest";
import {
  applyGoldenFixtureTransform,
  GOLDEN_FIXTURES,
  goldenFixtureUrl,
} from "./goldenFixtureManifest";

const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Root holding the `s1/` and `424/` fixture directories. Mirrors
 * {@link resolveAsset} usage elsewhere: `import.meta.dir` is `src/task/fixtures`
 * in dev and `dist/` after bundling, so both layouts are offered.
 */
export function resolveGoldenFixtureRoot(): string {
  return resolveAsset([
    join(importMetaDir, "../../sec/html/mock_data"),
    join(importMetaDir, "sec/html/mock_data"),
  ]);
}

export const GOLDEN_FIXTURE_MODES = ["download", "verify"] as const;
export type GoldenFixtureMode = (typeof GOLDEN_FIXTURE_MODES)[number];

/**
 * Outcome for one fixture.
 *
 * `remote-changed` and `local-modified` are kept distinct because they demand
 * opposite responses: the first means re-pin the manifest (or the wrong
 * document is pinned), the second means someone edited a golden fixture and the
 * tests it backs are now measuring an artifact rather than a real filing.
 */
export const GOLDEN_FIXTURE_STATUSES = [
  "ok",
  "written",
  "missing",
  "local-modified",
  "remote-changed",
  "error",
] as const;
export type GoldenFixtureStatus = (typeof GOLDEN_FIXTURE_STATUSES)[number];

export interface GoldenFixtureOutcome {
  readonly file: string;
  readonly status: GoldenFixtureStatus;
  /** Populated when the outcome is not `ok` / `written`. */
  readonly detail: string | undefined;
}

export interface GoldenFixtureDeps {
  /** Fetches a document's raw bytes, exactly as EDGAR serves them. */
  readonly fetchDoc: (url: string) => Promise<Uint8Array>;
  readonly log?: ((msg: string) => void) | undefined;
}

export interface GoldenFixtureOptions {
  readonly mode: GoldenFixtureMode;
  readonly deps: GoldenFixtureDeps;
  /** Defaults to the package-shipped `mock_data` root. */
  readonly rootDir?: string | undefined;
  /** Defaults to every entry in {@link GOLDEN_FIXTURES}. */
  readonly entries?: readonly GoldenFixtureEntry[] | undefined;
  /** Re-download and overwrite files that already match the manifest. */
  readonly force?: boolean | undefined;
}

export interface GoldenFixtureResult {
  readonly outcomes: readonly GoldenFixtureOutcome[];
  readonly ok: number;
  readonly written: number;
  readonly failed: number;
}

function readLocal(path: string): Uint8Array | undefined {
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
}

/**
 * Compare the committed files against the manifest **without any network
 * access**. This is what the hermetic test calls: it cannot detect an EDGAR-side
 * change, but it catches the failure that actually happens — a fixture edited in
 * place, silently re-baselining every golden test that reads it.
 */
export function checkGoldenFixturesOnDisk(
  rootDir: string = resolveGoldenFixtureRoot(),
  entries: readonly GoldenFixtureEntry[] = GOLDEN_FIXTURES
): readonly GoldenFixtureOutcome[] {
  return entries.map((entry) => {
    const local = readLocal(join(rootDir, entry.dir, entry.file));
    if (local === undefined) {
      return { file: entry.file, status: "missing" as const, detail: "not on disk" };
    }
    const actual = sha256Hex(local);
    if (actual !== entry.sha256) {
      return {
        file: entry.file,
        status: "local-modified" as const,
        detail: `sha256 ${actual} != manifest ${entry.sha256} (${local.length} bytes, manifest ${entry.bytes})`,
      };
    }
    return { file: entry.file, status: "ok" as const, detail: undefined };
  });
}

async function processEntry(
  entry: GoldenFixtureEntry,
  options: GoldenFixtureOptions,
  rootDir: string
): Promise<GoldenFixtureOutcome> {
  const { mode, deps, force } = options;
  const path = join(rootDir, entry.dir, entry.file);
  const local = readLocal(path);
  const localMatches = local !== undefined && sha256Hex(local) === entry.sha256;

  // Downloading is idempotent: an already-correct fixture is left alone unless
  // forced, so a re-run does not re-fetch the whole corpus from EDGAR.
  if (mode === "download" && localMatches && !force) {
    return { file: entry.file, status: "ok", detail: "already matches manifest" };
  }

  let raw: Uint8Array;
  try {
    raw = await deps.fetchDoc(goldenFixtureUrl(entry));
  } catch (err) {
    return { file: entry.file, status: "error", detail: (err as Error).message };
  }

  const remoteSha = sha256Hex(raw);
  if (remoteSha !== entry.remoteSha256) {
    return {
      file: entry.file,
      status: "remote-changed",
      detail: `remote sha256 ${remoteSha} != manifest ${entry.remoteSha256} (${raw.length} bytes)`,
    };
  }

  let body: Uint8Array;
  try {
    body = applyGoldenFixtureTransform(raw, entry.transform);
  } catch (err) {
    return { file: entry.file, status: "error", detail: (err as Error).message };
  }

  // The remote digest already matched, so a transform digest mismatch means the
  // manifest's own two hashes disagree — a bad pin, not a bad download.
  const bodySha = sha256Hex(body);
  if (bodySha !== entry.sha256) {
    return {
      file: entry.file,
      status: "error",
      detail: `transformed sha256 ${bodySha} != manifest ${entry.sha256}; manifest transform is wrong`,
    };
  }

  if (mode === "verify") {
    if (local === undefined) {
      return { file: entry.file, status: "missing", detail: "not on disk" };
    }
    if (!localMatches) {
      return {
        file: entry.file,
        status: "local-modified",
        detail: `on-disk sha256 ${sha256Hex(local)} != EDGAR-derived ${bodySha}`,
      };
    }
    return { file: entry.file, status: "ok", detail: undefined };
  }

  mkdirSync(join(rootDir, entry.dir), { recursive: true });
  writeFileSync(path, body);
  return { file: entry.file, status: "written", detail: undefined };
}

/** Run the manifest walk in `download` or `verify` mode. */
export async function runGoldenFixtures(
  options: GoldenFixtureOptions
): Promise<GoldenFixtureResult> {
  const entries = options.entries ?? GOLDEN_FIXTURES;
  const rootDir = options.rootDir ?? resolveGoldenFixtureRoot();
  const log = options.deps.log ?? ((m: string) => process.stderr.write(m + "\n"));

  log(
    `${options.mode === "verify" ? "Verifying" : "Downloading"} ${entries.length} golden fixtures in ${rootDir}`
  );

  const outcomes: GoldenFixtureOutcome[] = [];
  for (const entry of entries) {
    const outcome = await processEntry(entry, options, rootDir);
    outcomes.push(outcome);
    log(
      `  ${outcome.status.padEnd(15)} ${entry.file}${outcome.detail ? ` — ${outcome.detail}` : ""}`
    );
  }

  const ok = outcomes.filter((o) => o.status === "ok").length;
  const written = outcomes.filter((o) => o.status === "written").length;
  return { outcomes, ok, written, failed: outcomes.length - ok - written };
}
