/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../config/tokens";
import { getDb } from "../util/db";
import { getPgPool } from "../util/pg";
import {
  CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN,
  CANONICAL_UNDERWRITER_FAMILY_ALIAS_REPOSITORY_TOKEN,
} from "../storage/canonical/CanonicalAliasSchemas";
import { CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalSponsorFamilySchema";
import { CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalUnderwriterFamilySchema";
import { SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN } from "../storage/canonical/SponsorFamilyMembershipSchema";
import { UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN } from "../storage/canonical/UnderwriterFamilyMembershipSchema";
import { SPAC_SPONSOR_LINK_REPOSITORY_TOKEN } from "../storage/canonical/SpacSponsorLinkSchema";
import { UNDERWRITER_LINK_REPOSITORY_TOKEN } from "../storage/canonical/UnderwriterLinkSchema";

/**
 * Tables touched by the `migrate-uppercase` command. The tier-specific column
 * names diverge between sponsor and underwriter, so each variant is captured
 * once here and consumed by a single shared algorithm below.
 */
interface MigrationTarget {
  readonly canonicalTable: string;
  readonly pkColumn: string;
  readonly familyIdColumn: string;
  readonly membershipTable: string;
  readonly linkTable: string;
  readonly aliasTable: string;
  readonly canonicalRepoToken: typeof CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN;
  readonly aliasRepoToken: typeof CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN;
  readonly membershipRepoToken: typeof SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN;
  readonly linkRepoToken: typeof SPAC_SPONSOR_LINK_REPOSITORY_TOKEN;
}

const SPONSOR_TARGET: MigrationTarget = {
  canonicalTable: "canonical_sponsor_family",
  pkColumn: "canonical_sponsor_family_id",
  familyIdColumn: "canonical_sponsor_family_id",
  membershipTable: "sponsor_family_membership",
  linkTable: "spac_sponsor_link",
  aliasTable: "canonical_sponsor_family_alias",
  canonicalRepoToken: CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN,
  aliasRepoToken: CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN,
  membershipRepoToken: SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN,
  linkRepoToken: SPAC_SPONSOR_LINK_REPOSITORY_TOKEN,
};

const UNDERWRITER_TARGET: MigrationTarget = {
  canonicalTable: "canonical_underwriter_family",
  pkColumn: "canonical_underwriter_family_id",
  familyIdColumn: "canonical_underwriter_family_id",
  membershipTable: "underwriter_family_membership",
  linkTable: "underwriter_link",
  aliasTable: "canonical_underwriter_family_alias",
  canonicalRepoToken:
    CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN as unknown as typeof CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN,
  aliasRepoToken:
    CANONICAL_UNDERWRITER_FAMILY_ALIAS_REPOSITORY_TOKEN as unknown as typeof CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN,
  membershipRepoToken:
    UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN as unknown as typeof SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN,
  linkRepoToken:
    UNDERWRITER_LINK_REPOSITORY_TOKEN as unknown as typeof SPAC_SPONSOR_LINK_REPOSITORY_TOKEN,
};

export interface Collision {
  readonly lower_id: string;
  readonly upper_id: string;
  readonly resolver_version: string;
  readonly lower_name: string;
  readonly upper_name: string;
  readonly membership: number;
  readonly links: number;
  readonly aliases: number;
}

export interface MigrationResult {
  readonly planned: number;
  readonly collisions: Collision[];
  readonly applied: boolean;
}

export interface MigrationOptions {
  readonly apply: boolean;
  readonly resolverVersion: string | undefined;
}

/**
 * Returns the active backend kind for this migration. The "repository" backend
 * is the only path that does not assume the SQL helpers (`getDb` / `getPgPool`)
 * have been initialized; it is used by tests and any caller that wires
 * in-memory repositories via TestingDI.
 */
function activeBackend(): "sqlite" | "postgres" | "repository" {
  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;
  if (
    dbType === "sqlite" &&
    globalServiceRegistry.has(SEC_DB_FOLDER) &&
    globalServiceRegistry.has(SEC_DB_NAME)
  ) {
    return "sqlite";
  }
  if (dbType === "postgres") return "postgres";
  return "repository";
}

/**
 * Core migration: discovers every row whose `normalized_name` is not already
 * UPPER, refuses (exit code 2 via the caller) when an UPPER row already exists
 * under the same `resolver_version`, and otherwise UPPER-folds the offenders
 * inside a single backend-appropriate transaction.
 */
export async function migrateUppercase(
  target: MigrationTarget,
  opts: MigrationOptions
): Promise<MigrationResult> {
  const backend = activeBackend();
  if (backend === "sqlite") return migrateUppercaseSqlite(target, opts);
  if (backend === "postgres") return migrateUppercasePostgres(target, opts);
  return migrateUppercaseRepository(target, opts);
}

function migrateUppercaseSqlite(target: MigrationTarget, opts: MigrationOptions): MigrationResult {
  const db = getDb();
  const scope = opts.resolverVersion ? " AND resolver_version = ?" : "";
  const scopeParams: (string | number)[] = opts.resolverVersion ? [opts.resolverVersion] : [];

  // SQLite's BEGIN EXCLUSIVE acquires the writer lock immediately so we never
  // race a concurrent ingest between the planning SELECT and the UPDATE.
  db.exec("BEGIN EXCLUSIVE");
  try {
    const planStmt = db.prepare<(string | number)[], Record<string, unknown>>(
      `SELECT \`${target.pkColumn}\`, resolver_version, normalized_name
       FROM \`${target.canonicalTable}\`
       WHERE normalized_name <> UPPER(normalized_name)${scope}`
    );
    const planned = (planStmt.all(...scopeParams) as Record<string, unknown>[]).length;

    const collisions = collectSqliteCollisions(target, scope, scopeParams);

    if (collisions.length > 0) {
      db.exec("ROLLBACK");
      return { planned, collisions, applied: false };
    }

    if (!opts.apply) {
      db.exec("ROLLBACK");
      return { planned, collisions: [], applied: false };
    }

    db.prepare(
      `UPDATE \`${target.canonicalTable}\`
       SET normalized_name = UPPER(normalized_name)
       WHERE normalized_name <> UPPER(normalized_name)${scope}`
    ).run(...scopeParams);

    // Recount inside the transaction. A non-zero residual means a writer
    // committed between BEGIN EXCLUSIVE and the UPDATE — bail rather than
    // pretend success.
    const residualStmt = db.prepare<(string | number)[], { c: number }>(
      `SELECT COUNT(*) AS c
       FROM \`${target.canonicalTable}\`
       WHERE normalized_name <> UPPER(normalized_name)${scope}`
    );
    const residual = (residualStmt.all(...scopeParams) as { c: number }[])[0]?.c ?? 0;
    if (residual > 0) {
      db.exec("ROLLBACK");
      throw new Error(
        `concurrent ingest detected: ${residual} rows still lowercase after UPDATE; aborted`
      );
    }

    db.exec("COMMIT");
    return { planned, collisions: [], applied: true };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore — primary error below is the meaningful one
    }
    throw e;
  }
}

function collectSqliteCollisions(
  target: MigrationTarget,
  scope: string,
  scopeParams: (string | number)[]
): Collision[] {
  const db = getDb();
  const rows = db
    .prepare<
      (string | number)[],
      {
        lower_id: string;
        upper_id: string;
        resolver_version: string;
        lower_name: string;
        upper_name: string;
      }
    >(
      `SELECT a.\`${target.pkColumn}\` AS lower_id,
              b.\`${target.pkColumn}\` AS upper_id,
              a.resolver_version AS resolver_version,
              a.normalized_name AS lower_name,
              b.normalized_name AS upper_name
         FROM \`${target.canonicalTable}\` a
         JOIN \`${target.canonicalTable}\` b
           ON a.resolver_version = b.resolver_version
          AND UPPER(a.normalized_name) = b.normalized_name
          AND a.\`${target.pkColumn}\` <> b.\`${target.pkColumn}\`
        WHERE a.normalized_name <> UPPER(a.normalized_name)${scope.replace(/resolver_version/g, "a.resolver_version")}`
    )
    .all(...scopeParams) as {
    lower_id: string;
    upper_id: string;
    resolver_version: string;
    lower_name: string;
    upper_name: string;
  }[];

  return rows.map((r) => {
    const membership = (
      db
        .prepare<(string | number)[], { c: number }>(
          `SELECT COUNT(*) AS c FROM \`${target.membershipTable}\`
            WHERE resolver_version = ? AND \`${target.familyIdColumn}\` = ?`
        )
        .all(r.resolver_version, r.lower_id) as { c: number }[]
    )[0].c;
    const familyIdInLink =
      target === SPONSOR_TARGET ? "sponsor_family_id" : "underwriter_family_id";
    const links = (
      db
        .prepare<(string | number)[], { c: number }>(
          `SELECT COUNT(*) AS c FROM \`${target.linkTable}\`
            WHERE \`${familyIdInLink}\` = ?`
        )
        .all(r.lower_id) as { c: number }[]
    )[0].c;
    const aliases = (
      db
        .prepare<(string | number)[], { c: number }>(
          `SELECT COUNT(*) AS c FROM \`${target.aliasTable}\`
            WHERE alias_canonical_id = ? OR target_canonical_id = ?`
        )
        .all(r.lower_id, r.lower_id) as { c: number }[]
    )[0].c;
    return { ...r, membership, links, aliases };
  });
}

async function migrateUppercasePostgres(
  target: MigrationTarget,
  opts: MigrationOptions
): Promise<MigrationResult> {
  const pool = getPgPool();
  const client = await pool.connect();
  const scope = opts.resolverVersion ? " AND resolver_version = $1" : "";
  const scopeParams = opts.resolverVersion ? [opts.resolverVersion] : [];

  // SERIALIZABLE matches the BEGIN EXCLUSIVE semantics on SQLite: any
  // concurrent transaction touching these rows is forced to abort instead of
  // silently slipping in between plan and update.
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const planSql = `SELECT "${target.pkColumn}" AS pk, resolver_version, normalized_name
                     FROM "${target.canonicalTable}"
                     WHERE normalized_name <> UPPER(normalized_name)${scope}`;
    const planRes = await client.query(planSql, scopeParams);
    const planned = planRes.rowCount ?? planRes.rows.length;

    const collisions = await collectPgCollisions(target, scope, scopeParams, client);

    if (collisions.length > 0) {
      await client.query("ROLLBACK");
      return { planned, collisions, applied: false };
    }

    if (!opts.apply) {
      await client.query("ROLLBACK");
      return { planned, collisions: [], applied: false };
    }

    try {
      await client.query(
        `UPDATE "${target.canonicalTable}"
         SET normalized_name = UPPER(normalized_name)
         WHERE normalized_name <> UPPER(normalized_name)${scope}`,
        scopeParams
      );
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "42501") {
        await client.query("ROLLBACK");
        throw new Error(
          `operator account lacks UPDATE on ${target.canonicalTable}; GRANT UPDATE or run as DB owner`
        );
      }
      throw e;
    }

    const residualRes = await client.query(
      `SELECT COUNT(*) AS c
         FROM "${target.canonicalTable}"
         WHERE normalized_name <> UPPER(normalized_name)${scope}`,
      scopeParams
    );
    const residual = Number(residualRes.rows[0]?.c ?? 0);
    if (residual > 0) {
      await client.query("ROLLBACK");
      throw new Error(
        `concurrent ingest detected: ${residual} rows still lowercase after UPDATE; aborted`
      );
    }

    await client.query("COMMIT");
    return { planned, collisions: [], applied: true };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore — primary error below is the meaningful one
    }
    throw e;
  } finally {
    client.release();
  }
}

async function collectPgCollisions(
  target: MigrationTarget,
  scope: string,
  scopeParams: string[],
  client: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>;
  }
): Promise<Collision[]> {
  const sql = `SELECT a."${target.pkColumn}" AS lower_id,
                      b."${target.pkColumn}" AS upper_id,
                      a.resolver_version AS resolver_version,
                      a.normalized_name AS lower_name,
                      b.normalized_name AS upper_name
                 FROM "${target.canonicalTable}" a
                 JOIN "${target.canonicalTable}" b
                   ON a.resolver_version = b.resolver_version
                  AND UPPER(a.normalized_name) = b.normalized_name
                  AND a."${target.pkColumn}" <> b."${target.pkColumn}"
                WHERE a.normalized_name <> UPPER(a.normalized_name)${scope.replace(/resolver_version/g, "a.resolver_version")}`;
  const res = await client.query(sql, scopeParams);

  const familyIdInLink = target === SPONSOR_TARGET ? "sponsor_family_id" : "underwriter_family_id";

  const collisions: Collision[] = [];
  for (const r of res.rows) {
    const mRes = await client.query(
      `SELECT COUNT(*)::int AS c FROM "${target.membershipTable}"
        WHERE resolver_version = $1 AND "${target.familyIdColumn}" = $2`,
      [r.resolver_version, r.lower_id]
    );
    const lRes = await client.query(
      `SELECT COUNT(*)::int AS c FROM "${target.linkTable}"
        WHERE "${familyIdInLink}" = $1`,
      [r.lower_id]
    );
    const aRes = await client.query(
      `SELECT COUNT(*)::int AS c FROM "${target.aliasTable}"
        WHERE alias_canonical_id = $1 OR target_canonical_id = $1`,
      [r.lower_id]
    );
    collisions.push({
      lower_id: r.lower_id,
      upper_id: r.upper_id,
      resolver_version: r.resolver_version,
      lower_name: r.lower_name,
      upper_name: r.upper_name,
      membership: Number(mRes.rows[0]?.c ?? 0),
      links: Number(lRes.rows[0]?.c ?? 0),
      aliases: Number(aRes.rows[0]?.c ?? 0),
    });
  }
  return collisions;
}

interface FamilyLikeRow {
  readonly resolver_version: string;
  readonly normalized_name: string;
  readonly display_name: string | null;
  readonly created_at: string;
  readonly [pk: string]: unknown;
}

async function migrateUppercaseRepository(
  target: MigrationTarget,
  opts: MigrationOptions
): Promise<MigrationResult> {
  // The in-memory repo dispatch lets tests exercise the same find/collision
  // logic without standing up SQLite. There's no real transaction here — the
  // tests serialize calls themselves — but the algorithm shape mirrors the SQL
  // paths so the dry-run/--apply contract is identical.
  const canonRepo = globalServiceRegistry.get(target.canonicalRepoToken) as any;
  const all: FamilyLikeRow[] = (await canonRepo.getAll()) ?? [];
  const offenders = all.filter((r) => {
    if (r.normalized_name !== r.normalized_name.toUpperCase()) {
      return opts.resolverVersion ? r.resolver_version === opts.resolverVersion : true;
    }
    return false;
  });

  const planned = offenders.length;

  const collisions: Collision[] = [];
  for (const offender of offenders) {
    const upperName = offender.normalized_name.toUpperCase();
    const collision = all.find(
      (r) =>
        r.resolver_version === offender.resolver_version &&
        r.normalized_name === upperName &&
        r[target.pkColumn] !== offender[target.pkColumn]
    );
    if (collision) {
      const lowerId = String(offender[target.pkColumn]);
      const upperId = String(collision[target.pkColumn]);
      const familyIdInLink =
        target === SPONSOR_TARGET ? "sponsor_family_id" : "underwriter_family_id";
      const membershipRepo = globalServiceRegistry.get(target.membershipRepoToken) as any;
      const linkRepo = globalServiceRegistry.get(target.linkRepoToken) as any;
      const aliasRepo = globalServiceRegistry.get(target.aliasRepoToken) as any;
      const membershipRows = ((await membershipRepo.getAll()) ?? []).filter(
        (m: any) =>
          m.resolver_version === offender.resolver_version && m[target.familyIdColumn] === lowerId
      );
      const linkRows = ((await linkRepo.getAll()) ?? []).filter(
        (l: any) => l[familyIdInLink] === lowerId
      );
      const aliasRows = ((await aliasRepo.getAll()) ?? []).filter(
        (a: any) => a.alias_canonical_id === lowerId || a.target_canonical_id === lowerId
      );
      collisions.push({
        lower_id: lowerId,
        upper_id: upperId,
        resolver_version: offender.resolver_version,
        lower_name: offender.normalized_name,
        upper_name: upperName,
        membership: membershipRows.length,
        links: linkRows.length,
        aliases: aliasRows.length,
      });
    }
  }

  if (collisions.length > 0) {
    return { planned, collisions, applied: false };
  }

  if (!opts.apply) {
    return { planned, collisions: [], applied: false };
  }

  for (const offender of offenders) {
    const upperName = offender.normalized_name.toUpperCase();
    await canonRepo.put({ ...offender, normalized_name: upperName });
  }

  return { planned, collisions: [], applied: true };
}

function printCollisions(collisions: Collision[]): void {
  // TSV header explained in the plan so an operator can pipe to `column -t`
  // or paste into a spreadsheet without parsing fuss.
  process.stderr.write("lower_id\tupper_id\tnormalized_name\tmembership\tlinks\taliases\n");
  for (const c of collisions) {
    process.stderr.write(
      `${c.lower_id}\t${c.upper_id}\t${c.lower_name}\t${c.membership}\t${c.links}\t${c.aliases}\n`
    );
  }
}

function attachMigrateSubcommand(
  parent: Command,
  target: MigrationTarget,
  aliasCommand: string
): void {
  parent
    .command("migrate-uppercase")
    .description(
      `One-shot migration: UPPER-fold every lowercase normalized_name in ${target.canonicalTable}.`
    )
    .option("--apply", "Apply the changes (default is dry-run)", false)
    .option("--resolver-version <v>", "Scope to a single resolver version")
    .action(async (opts: { apply: boolean; resolverVersion?: string }) => {
      let result: MigrationResult;
      try {
        result = await migrateUppercase(target, {
          apply: opts.apply,
          resolverVersion: opts.resolverVersion,
        });
      } catch (e) {
        process.stderr.write(`error: ${(e as Error).message}\n`);
        process.exit(1);
      }

      if (result.collisions.length > 0) {
        printCollisions(result.collisions);
        process.stderr.write(
          `error: ${result.collisions.length} collisions block UPPER-fold. ` +
            `Merge each lower_id into the matching upper_id with ` +
            `\`sec canonical ${aliasCommand} alias <from-name> <into-name>\` ` +
            `before re-running migrate-uppercase.\n`
        );
        process.exit(2);
      }

      if (result.applied) {
        console.log(`applied: UPPER-folded ${result.planned} rows in ${target.canonicalTable}`);
      } else {
        console.log(
          `dry-run: ${result.planned} rows in ${target.canonicalTable} would be UPPER-folded. ` +
            `Re-run with --apply to write.`
        );
      }
    });
}

/**
 * Adds `migrate-uppercase` to the existing `canonical sponsor-family` /
 * `canonical underwriter-family` subcommands. Call AFTER
 * {@link registerSponsorFamilyCommands} and
 * {@link registerUnderwriterFamilyCommands} so those subcommands already exist.
 */
export function registerCanonicalFamilyMigrateCommands(program: Command): void {
  const canonical = program.commands.find((c) => c.name() === "canonical");
  if (!canonical) return;

  const sponsor = canonical.commands.find((c) => c.name() === "sponsor-family");
  if (sponsor) attachMigrateSubcommand(sponsor, SPONSOR_TARGET, "sponsor-family");

  const underwriter = canonical.commands.find((c) => c.name() === "underwriter-family");
  if (underwriter) attachMigrateSubcommand(underwriter, UNDERWRITER_TARGET, "underwriter-family");
}

export const _internal = {
  SPONSOR_TARGET,
  UNDERWRITER_TARGET,
  migrateUppercase,
};
