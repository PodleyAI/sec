/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import type { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../config/tokens";
import { SecCliConfigurationError } from "../config/EnvToDI";
import { getDb } from "../util/db";
import { getPgPool } from "../util/pg";
import { CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalSponsorFamilySchema";
import { CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalUnderwriterFamilySchema";

export interface StaleCanonicalCounts {
  readonly sponsor: number;
  readonly underwriter: number;
}

/**
 * Returns the number of canonical-family rows whose `normalized_name` is not
 * already UPPER. A non-zero count means resolution would silently double-mint,
 * since the resolver looks up names case-sensitively post-revert.
 */
export async function checkStaleCanonicalFamilies(): Promise<StaleCanonicalCounts> {
  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;

  if (
    dbType === "sqlite" &&
    globalServiceRegistry.has(SEC_DB_FOLDER) &&
    globalServiceRegistry.has(SEC_DB_NAME)
  ) {
    const db = getDb();
    const sponsor =
      (
        db
          .prepare<
            [],
            { c: number }
          >("SELECT COUNT(*) AS c FROM `canonical_sponsor_family` WHERE normalized_name <> UPPER(normalized_name)")
          .all() as { c: number }[]
      )[0]?.c ?? 0;
    const underwriter =
      (
        db
          .prepare<
            [],
            { c: number }
          >("SELECT COUNT(*) AS c FROM `canonical_underwriter_family` WHERE normalized_name <> UPPER(normalized_name)")
          .all() as { c: number }[]
      )[0]?.c ?? 0;
    return { sponsor, underwriter };
  }

  if (dbType === "postgres") {
    const pool = getPgPool();
    const sponsorRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM "canonical_sponsor_family" WHERE normalized_name <> UPPER(normalized_name)`
    );
    const underwriterRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM "canonical_underwriter_family" WHERE normalized_name <> UPPER(normalized_name)`
    );
    return {
      sponsor: Number(sponsorRes.rows[0]?.c ?? 0),
      underwriter: Number(underwriterRes.rows[0]?.c ?? 0),
    };
  }

  // In-memory / test fallback: scan the repository directly.
  const sponsorRepo = globalServiceRegistry.has(CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN)
    ? globalServiceRegistry.get(CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN)
    : null;
  const underwriterRepo = globalServiceRegistry.has(CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN)
    ? globalServiceRegistry.get(CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN)
    : null;
  const sponsorRows = sponsorRepo ? ((await sponsorRepo.getAll()) ?? []) : [];
  const underwriterRows = underwriterRepo ? ((await underwriterRepo.getAll()) ?? []) : [];
  const sponsor = sponsorRows.filter(
    (r) => r.normalized_name !== r.normalized_name.toUpperCase()
  ).length;
  const underwriter = underwriterRows.filter(
    (r) => r.normalized_name !== r.normalized_name.toUpperCase()
  ).length;
  return { sponsor, underwriter };
}

/**
 * Subcommand-path categorisation. Commands that depend on family resolution
 * round-tripping correctly (`resolve`, `… by-family`, family `alias`) must
 * hard-fail; everything else only warns. The `migrate-uppercase` command
 * itself is exempt — the whole point is to be able to run it.
 */
function commandPath(actionCommand: Command): string[] {
  const path: string[] = [];
  let cursor: Command | null = actionCommand;
  while (cursor && cursor.name() !== "" && cursor.parent !== null) {
    path.unshift(cursor.name());
    cursor = cursor.parent;
  }
  return path;
}

function isMigrateCommand(path: string[]): boolean {
  return path[path.length - 1] === "migrate-uppercase";
}

function isExemptCommand(path: string[]): boolean {
  if (path.length === 0) return true;
  const first = path[0];
  if (first === "init") return true;
  if (first === "db") return true;
  if (isMigrateCommand(path)) return true;
  return false;
}

function isSafetyCritical(path: string[]): boolean {
  // `resolve` is the batch-resolve top-level command.
  if (path[0] === "resolve") return true;
  // `sec spac by-family` / `sec underwriter by-family`.
  if ((path[0] === "spac" || path[0] === "underwriter") && path[path.length - 1] === "by-family") {
    return true;
  }
  // `sec canonical {person,company,sponsor-family,underwriter-family} alias`.
  if (path[0] === "canonical" && path[path.length - 1] === "alias") return true;
  return false;
}

function describeMessage(counts: StaleCanonicalCounts): string {
  const total = counts.sponsor + counts.underwriter;
  return (
    `${total} stale lowercase rows in canonical_sponsor_family (${counts.sponsor}) ` +
    `and canonical_underwriter_family (${counts.underwriter}). ` +
    `Run \`sec canonical {sponsor,underwriter}-family migrate-uppercase --apply\` to fix. ` +
    `Family resolution will silently double-mint without this. ` +
    `Pass \`--allow-stale\` to override.`
  );
}

export interface RunStaleCanonicalGuardOptions {
  readonly actionCommand: Command;
  readonly allowStale: boolean;
  readonly useColor: boolean;
}

/**
 * Runs the cheap two-count check and either warns or throws depending on the
 * subcommand category. Designed to be called from the program's `preAction`
 * hook AFTER DI is fully initialized.
 */
export async function runStaleCanonicalGuard(opts: RunStaleCanonicalGuardOptions): Promise<void> {
  const path = commandPath(opts.actionCommand);

  if (isExemptCommand(path)) return;
  if (opts.allowStale) return;

  let counts: StaleCanonicalCounts;
  try {
    counts = await checkStaleCanonicalFamilies();
  } catch {
    // A guard failure must never block the underlying command — the user
    // might be running on a DB that does not yet have these tables (e.g.
    // first-run before `db setup`). Treat any read failure as "no stale rows
    // detected"; the migrate command is still available to operators.
    return;
  }

  if (counts.sponsor + counts.underwriter === 0) return;

  const body = describeMessage(counts);

  if (isSafetyCritical(path)) {
    throw new SecCliConfigurationError(body);
  }

  // Yellow ANSI when color is allowed; the harness's plain `console.warn` is
  // already routed to stderr.
  if (opts.useColor) {
    console.warn(`\x1b[33m${body}\x1b[0m`);
  } else {
    console.warn(body);
  }
}

export const _internal = {
  commandPath,
  isExemptCommand,
  isSafetyCritical,
  describeMessage,
};
