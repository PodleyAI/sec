/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, MIGRATIONS_TABLE } from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { secFetchRateLimiterLedgerComponents } from "../task/fetch/SecJobQueue";
import { secFetchRateLimiterTableNames } from "../task/fetch/secFetchRateLimiterConfig";
import { getDb } from "../util/db";
import { getPgPool } from "../util/pg";
import { currentSchemaName, quote } from "../util/pgIdentifiers";
import {
  listDatabaseExtensionTokens,
  listDatabaseViewNames,
  runDatabaseSetupHooks,
} from "./databaseExtensions";
import { listRegisteredTables } from "./tableRegistry";
import { SEC_DB_TYPE } from "./tokens";
import { ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN } from "../storage/address/AddressHistorySchema";
import {
  ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  ADDRESS_REPOSITORY_TOKEN,
} from "../storage/address/AddressSchema";
import { CHANGE_LOG_REPOSITORY_TOKEN } from "../storage/change-tracking/ChangeLogSchema";
import { CIK_NAME_REPOSITORY_TOKEN } from "../storage/entity/CikNameSchema";
import { ENTITY_HISTORY_REPOSITORY_TOKEN } from "../storage/entity/EntityHistorySchema";
import { ENTITY_REPOSITORY_TOKEN } from "../storage/entity/EntitySchema";
import { ENTITY_TICKER_REPOSITORY_TOKEN } from "../storage/entity/EntityTickerSchema";
import { SIC_CODE_REPOSITORY_TOKEN } from "../storage/entity/SicCodeSchema";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../storage/facts/CompanyFactsSchema";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { FILING_DOCUMENT_REPOSITORY_TOKEN } from "../storage/document/FilingDocumentSchema";
import { FILING_SECTION_REPOSITORY_TOKEN } from "../storage/document/FilingSectionSchema";
import { INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN } from "../storage/investment-offering/InvestmentOfferingHistorySchema";
import { INVESTMENT_OFFERING_REPOSITORY_TOKEN } from "../storage/investment-offering/InvestmentOfferingSchema";
import { ISSUER_REPOSITORY_TOKEN } from "../storage/investment-offering/IssuerSchema";
import {
  PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  PHONE_REPOSITORY_TOKEN,
} from "../storage/phone/PhoneSchema";
import { CROWDFUNDING_HISTORY_REPOSITORY_TOKEN } from "../storage/portal/CrowdfundingHistorySchema";
import {
  CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN,
  CROWDFUNDING_REPORTS_REPOSITORY_TOKEN,
  CROWDFUNDING_REPOSITORY_TOKEN,
} from "../storage/portal/CrowdfundingSchema";
import { PORTAL_REPOSITORY_TOKEN } from "../storage/portal/PortalSchema";
import { PORTAL_SUCCESSION_REPOSITORY_TOKEN } from "../storage/portal/PortalSuccessionSchema";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../storage/processing/CikLastUpdateSchema";
import { DAILY_INDEX_CURSOR_REPOSITORY_TOKEN } from "../storage/processing/DailyIndexCursorSchema";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../storage/processing/ProcessedFactsSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../storage/processing/ProcessedSubmissionsSchema";
import { REGA_CURRENT_REPORT_REPOSITORY_TOKEN } from "../storage/reg-a/RegACurrentReportSchema";
import { REGA_OFFERING_EVENT_REPOSITORY_TOKEN } from "../storage/reg-a/RegAOfferingEventSchema";
import { REGA_EQUITY_CLASS_REPOSITORY_TOKEN } from "../storage/reg-a/RegAEquityClassSchema";
import { REGA_FINANCIAL_DATA_REPOSITORY_TOKEN } from "../storage/reg-a/RegAFinancialDataSchema";
import { REGA_OFFERING_HISTORY_REPOSITORY_TOKEN } from "../storage/reg-a/RegAOfferingHistorySchema";
import { REGA_OFFERING_REPOSITORY_TOKEN } from "../storage/reg-a/RegAOfferingSchema";
import { REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN } from "../storage/reg-a/RegAServiceProviderSchema";
import { FORM_8K_EVENT_REPOSITORY_TOKEN } from "../storage/form-8k-event/Form8KEventSchema";
import { COMPANY_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/CompanyObservationSchema";
import { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/PersonObservationSchema";
import { PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN } from "../storage/observation/PersonObservationTitleSchema";
import { ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN } from "../storage/canonical/RoleRosterCompletenessSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../storage/versioning/ComponentVersionSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../storage/versioning/ExtractorRunSchema";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "../storage/versioning/VersionEventSchema";
import { BENEFICIAL_OWNERSHIP_REPOSITORY_TOKEN } from "../storage/beneficial-ownership/BeneficialOwnershipSchema";
import { EXECUTIVE_COMPENSATION_REPOSITORY_TOKEN } from "../storage/executive-compensation/ExecutiveCompensationSchema";
import { S1_CLASSIFICATION_REPOSITORY_TOKEN } from "../storage/classification/S1ClassificationSchema";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../storage/dead-letter/ExtractionDeadLetterSchema";
import {
  FORM144_ACQUISITION_REPOSITORY_TOKEN,
  FORM144_FILING_REPOSITORY_TOKEN,
  FORM144_RECENT_SALE_REPOSITORY_TOKEN,
} from "../storage/form144/Form144Schema";
import { ISSUER_TICKER_REPOSITORY_TOKEN } from "../storage/offering/IssuerTickerSchema";
import { OFFERING_TERMS_REPOSITORY_TOKEN } from "../storage/offering/OfferingTermsSchema";
import { SPAC_UNIT_TERMS_REPOSITORY_TOKEN } from "../storage/offering/SpacUnitTermsSchema";
import { SPAC_PROMOTE_TERMS_REPOSITORY_TOKEN } from "../storage/offering/SpacPromoteTermsSchema";
import { OBSERVATION_PROVENANCE_REPOSITORY_TOKEN } from "../storage/provenance/ObservationProvenanceSchema";
import { RELATED_PARTY_TRANSACTION_REPOSITORY_TOKEN } from "../storage/related-party/RelatedPartyTransactionSchema";
import {
  SECTION16_FILING_REPOSITORY_TOKEN,
  SECTION16_HOLDING_REPOSITORY_TOKEN,
  SECTION16_TRANSACTION_REPOSITORY_TOKEN,
} from "../storage/section16/Section16Schema";
import { XBRL_FACT_REPOSITORY_TOKEN } from "../storage/xbrl/XbrlFactSchema";

/** Options for {@link resetAllDatabases}. */
export interface ResetAllDatabasesOptions {
  /** Drop dependent objects (views, etc.) along with the owned tables. */
  readonly cascade?: boolean;
  /**
   * Postgres only: drop and recreate the whole schema instead of the owned
   * objects. Destroys everything in the schema, including objects sec does not
   * own. The historical behavior, kept as an explicit escape hatch.
   */
  readonly dropSchema?: boolean;
}

/**
 * Drops the tables sec owns so `setupAllDatabases()` can recreate them at the
 * current DDL. Used by `sec db reset --confirm`.
 *
 * Dropping rather than truncating is what makes a reset a genuine clean slate:
 * `deleteAll()` only removes rows, so a table whose columns changed since the
 * database was created keeps its old shape — `CREATE TABLE IF NOT EXISTS`
 * never alters an existing table.
 *
 * What it drops is scoped to the {@link listRegisteredTables} ownership list
 * (every table built through `createStorage`, sec's and any superset's) plus
 * the few tables and views created outside it. A reset must not be a
 * whole-database wipe: sec is routinely one schema among several, and
 * destroying an unrelated table or a colleague's reporting view is not
 * something a "reset sec's tables" command may do. Tables that are present but
 * unowned are reported rather than dropped, which still surfaces the orphan of
 * a removed repo without the blast radius. The shared migration ledger is
 * scoped the same way — see {@link clearOwnedLedgerRows}.
 *
 * `dropSchema` restores the historical whole-schema drop for anyone who wants
 * it; `cascade` drops dependent objects along with the owned tables.
 */
export async function resetAllDatabases(options: ResetAllDatabasesOptions = {}): Promise<void> {
  // Raw DDL reaches around the repository layer, so the dry-run
  // ReadOnlyTabularStorage wrapper cannot intercept it — bail explicitly.
  if (isDryRun()) return;

  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;

  if (dbType === "postgres" || dbType === "sqlite") {
    // Let downstream packages register their DI repos before we read the
    // ownership registry: a superset's tables only land in it once its repo
    // family has been built through `createStorage`, and the documented seam
    // (`registerDatabaseExtension`) promises those tables are dropped by
    // `db reset` as well as created by `db setup`. Without this, a superset that
    // registers only through the setup hook has every one of its tables reported
    // as unowned and silently left in place. Idempotent — a superset whose CLI
    // preAction already registered is a no-op.
    //
    // Only on a real backend: a hook builds its repos through `createStorage`,
    // which reads SEC_DB_TYPE unguarded and opens the SQLite/Postgres handle.
    // The in-memory fallback below has neither, and truncates by DI token
    // rather than by the registry, so running hooks there would only throw.
    runDatabaseSetupHooks();
  }

  if (dbType === "postgres") {
    await resetPostgres(options);
    return;
  }

  if (dbType === "sqlite") {
    resetSqlite(options);
    return;
  }

  // In-memory / other backends have no schema to drop, so fall back to
  // truncating each registered repository.
  await truncateAllRepositories();
}

/**
 * Every table name this reset owns: the registry plus the few created outside it.
 *
 * The rate-limiter tables are derived from the configuration
 * `setupSecFetchRateLimiter()` builds its storage with, not named literally:
 * `PostgresRateLimiterStorage` renames them when it is given prefix columns,
 * and a reset that kept dropping the unprefixed names would silently leave the
 * real ones — and their execution rows — behind, so a recreated database would
 * inherit a rate-limit budget from before the reset.
 */
export function ownedTableNames(): ReadonlyArray<string> {
  return [...listRegisteredTables().map((t) => t.table), ...secFetchRateLimiterTableNames()];
}

async function resetPostgres(options: ResetAllDatabasesOptions): Promise<void> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    // Every drop below is schema-qualified. An unqualified `DROP TABLE` resolves
    // through the search_path, so a name sec owns but that is absent from the
    // current schema would be found — and destroyed — in the NEXT schema on the
    // path. That is exactly the unowned-object destruction this reset exists to
    // avoid, and it is the common shape: sec in its own schema with `public`
    // still on the path.
    const schema = await currentSchemaName(client, "db reset");
    const qualify = (object: string): string => `"${quote(schema)}"."${quote(object)}"`;

    if (options.dropSchema) {
      // CASCADE clears tables, views, sequences and indexes in one statement.
      // Destroys unowned objects too — opt-in only. Resolved from
      // `current_schema()` rather than hardcoded to `public`: sec's tables live
      // wherever the connection's search_path points (SEC_PG_URL can carry
      // `options=-csearch_path=…`), and dropping `public` there would destroy
      // an unrelated schema while leaving every sec table standing.
      await client.query(`DROP SCHEMA "${quote(schema)}" CASCADE`);
      await client.query(`CREATE SCHEMA "${quote(schema)}"`);
      return;
    }

    const owned = ownedTableNames();
    const present = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
      []
    );
    const presentNames = present.rows.map((r: { table_name: string }) => r.table_name);
    reportUnownedTables(presentNames, owned);

    // One transaction for the whole set. Postgres has transactional DDL, so a
    // drop blocked partway through — a reporting view on `filings`, say — rolls
    // the earlier drops back instead of leaving the caller with half a database
    // and no recreate: `DbResetTask` never reaches `setupAllDatabases()` once
    // this throws. "Reset" has to mean all-or-nothing, or the failure mode is
    // worse than not running it.
    await client.query("BEGIN");
    try {
      // Views first: they depend on the tables, so dropping them up front keeps
      // the table drops from needing CASCADE. Every view is contributed now —
      // the tier that owns the tables under them registers its own.
      for (const view of listDatabaseViewNames()) {
        await client.query(
          `DROP VIEW IF EXISTS ${qualify(view)}${options.cascade ? " CASCADE" : ""}`
        );
      }
      for (const table of owned) {
        const sql = `DROP TABLE IF EXISTS ${qualify(table)}${options.cascade ? " CASCADE" : ""}`;
        try {
          await client.query(sql);
        } catch (err) {
          throw dependentObjectError(err, table, sql);
        }
      }
      await clearOwnedLedgerRows(client, qualify, presentNames);
      await client.query("COMMIT");
    } catch (err) {
      // Best-effort: the transaction is already aborted, so this only clears the
      // connection's state. Swallow its own failure so the original error is
      // what surfaces.
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  } finally {
    client.release();
  }
}

/**
 * Removes the applied-version rows sec's own setup wrote for the tables this
 * reset just dropped — and only those.
 *
 * `_storage_migrations` is `@workglow/storage`'s ledger, and every package built
 * on it records there under one fixed table name: a row per applied
 * `(component, version)`. Dropping the table would take a co-tenant's rows with
 * it, and their next setup would then replay `addColumn` ops against tables that
 * already carry those columns — exactly the destroy-what-you-do-not-own this
 * reset exists to avoid. So the rows go by component and the table stays
 * standing; `--drop-schema` still takes it along with everything else.
 *
 * Clearing sec's own rows is not optional, though: a runner skips a
 * `(component, version)` it finds recorded, so a row outliving the table its
 * migration created would stop `db setup` from ever recreating it. Today that is
 * only the Postgres rate limiter — no sec table declares migrations, and
 * `createStorage` does not even accept them.
 */
async function clearOwnedLedgerRows(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  qualify: (object: string) => string,
  presentNames: ReadonlyArray<string>
): Promise<void> {
  const components = secFetchRateLimiterLedgerComponents();
  // Nothing of ours recorded, or no ledger in this schema at all (nothing on
  // this database ever declared a migration) — `DELETE FROM` a table that does
  // not exist would abort the transaction the drops just ran in.
  if (components.length === 0 || !presentNames.includes(MIGRATIONS_TABLE)) return;
  await client.query(`DELETE FROM ${qualify(MIGRATIONS_TABLE)} WHERE component = ANY($1)`, [
    components,
  ]);
}

function resetSqlite(options: ResetAllDatabasesOptions): void {
  // SQLite has neither a droppable schema nor `DROP TABLE ... CASCADE`, and the
  // scoped path below is already what either flag would degrade to. Say so
  // rather than accepting the flag and silently doing something else.
  if (options.cascade || options.dropSchema) {
    console.warn(
      "db reset: --cascade / --drop-schema are Postgres-only; the SQLite reset drops the " +
        "tables sec owns either way."
    );
  }
  const db = getDb();
  const present = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  const owned = ownedTableNames();
  reportUnownedTables(
    present.map((t) => t.name),
    owned
  );

  // FKs off for the duration: dropping in list order would otherwise fail on a
  // table still referenced by one not yet dropped.
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const view of listDatabaseViewNames()) {
      db.exec(`DROP VIEW IF EXISTS "${quote(view)}"`);
    }
    // SQLite has a single schema per attached database, so an unqualified name
    // cannot resolve outside it the way Postgres's search_path allows.
    for (const table of owned) {
      db.exec(`DROP TABLE IF EXISTS "${quote(table)}"`);
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Names tables that exist but are not sec's, so an operator can see what a
 * scoped reset deliberately left in place — including the orphan table of a
 * repository that was removed, which no per-repo list could ever reach.
 *
 * The list is NOT a drop list. `_storage_migrations` is always on it — the
 * shared ledger is deliberately left standing (see {@link clearOwnedLedgerRows})
 * and dropping it would destroy every co-tenant's applied-version rows — so the
 * message asks for review rather than telling the operator to drop what it names.
 */
function reportUnownedTables(present: ReadonlyArray<string>, owned: ReadonlyArray<string>): void {
  const ownedSet = new Set(owned);
  const unowned = present.filter((name) => !ownedSet.has(name)).sort();
  if (unowned.length > 0) {
    console.warn(
      `db reset: left ${unowned.length} table(s) in place that sec does not own: ` +
        `${unowned.join(", ")}. Review before dropping any by hand — ${MIGRATIONS_TABLE} is ` +
        `shared infrastructure that must survive, not an orphan of a removed repository.`
    );
  }
}

/**
 * Turns Postgres's terse `2BP01` (dependent objects still exist) into an error
 * that says which table blocked, what Postgres said depends on it, and how to
 * proceed.
 */
function dependentObjectError(err: unknown, table: string, sql: string): unknown {
  const code = (err as { code?: string } | null)?.code;
  if (code !== "2BP01") return err;
  const detail = (err as { detail?: string }).detail ?? "(no detail reported)";
  return new Error(
    `db reset: could not drop "${table}" — other objects depend on it. ${detail} ` +
      `Re-run with --cascade to drop those dependents too, or --drop-schema to drop and ` +
      `recreate the entire schema (which also destroys objects sec does not own). ` +
      `Failing statement: ${sql}`,
    { cause: err }
  );
}

/**
 * Row-level fallback for backends without a droppable schema.
 *
 * NOTE: When adding a table to the storage registry, add its deleteAll() call
 * here so reset doesn't leave orphan rows behind — `resetAllDatabases.test.ts`
 * fails on the gap.
 */
async function truncateAllRepositories(): Promise<void> {
  await globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ADDRESS_JUNCTION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PHONE_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(INVESTMENT_OFFERING_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ISSUER_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ENTITY_TICKER_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(SIC_CODE_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(FILING_SECTION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CROWDFUNDING_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CROWDFUNDING_REPORTS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CROWDFUNDING_HISTORY_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CHANGE_LOG_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PORTAL_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PORTAL_SUCCESSION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_OFFERING_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_OFFERING_HISTORY_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_FINANCIAL_DATA_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_EQUITY_CLASS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_CURRENT_REPORT_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(REGA_OFFERING_EVENT_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PERSON_OBSERVATION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(COMPANY_OBSERVATION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(FORM_8K_EVENT_REPOSITORY_TOKEN).deleteAll();
  // Observation provenance + AI-extracted offering / ownership / related-party tiers.
  await globalServiceRegistry.get(OBSERVATION_PROVENANCE_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(BENEFICIAL_OWNERSHIP_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(EXECUTIVE_COMPENSATION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(RELATED_PARTY_TRANSACTION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(S1_CLASSIFICATION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(ISSUER_TICKER_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(OFFERING_TERMS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(SPAC_UNIT_TERMS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(SPAC_PROMOTE_TERMS_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(XBRL_FACT_REPOSITORY_TOKEN).deleteAll();
  // Section 16 (Forms 3/4/5) and Form 144 detail tables.
  await globalServiceRegistry.get(SECTION16_FILING_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(SECTION16_TRANSACTION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(SECTION16_HOLDING_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(FORM144_FILING_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(FORM144_ACQUISITION_REPOSITORY_TOKEN).deleteAll();
  await globalServiceRegistry.get(FORM144_RECENT_SALE_REPOSITORY_TOKEN).deleteAll();
  // Family-tier canonical / alias / membership / link tables (sponsor + underwriter).
  // Truncate any downstream-registered extension repos after the built-in ones.
  for (const token of listDatabaseExtensionTokens()) {
    await globalServiceRegistry.get(token).deleteAll();
  }
}
