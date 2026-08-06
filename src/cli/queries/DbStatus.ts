import type { ServiceToken } from "workglow";
import { globalServiceRegistry } from "workglow";
import { getPgPool } from "../../util/pg";
import { resolveSqlBackend } from "../../util/sqlBackend";
import { ADDRESS_REPOSITORY_TOKEN } from "../../storage/address/AddressSchema";
import { CIK_NAME_REPOSITORY_TOKEN } from "../../storage/entity/CikNameSchema";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../../storage/facts/CompanyFactsSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { INVESTMENT_OFFERING_REPOSITORY_TOKEN } from "../../storage/investment-offering/InvestmentOfferingSchema";
import { PHONE_REPOSITORY_TOKEN } from "../../storage/phone/PhoneSchema";
import { CROWDFUNDING_REPOSITORY_TOKEN } from "../../storage/portal/CrowdfundingSchema";
import { PORTAL_REPOSITORY_TOKEN } from "../../storage/portal/PortalSchema";
import {
  SECTION16_FILING_REPOSITORY_TOKEN,
  SECTION16_HOLDING_REPOSITORY_TOKEN,
  SECTION16_TRANSACTION_REPOSITORY_TOKEN,
} from "../../storage/section16/Section16Schema";
import {
  FORM144_ACQUISITION_REPOSITORY_TOKEN,
  FORM144_FILING_REPOSITORY_TOKEN,
  FORM144_RECENT_SALE_REPOSITORY_TOKEN,
} from "../../storage/form144/Form144Schema";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedFactsSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "../../storage/observation/PersonObservationSchema";
import { PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN } from "../../storage/observation/PersonObservationTitleSchema";
import { PERSON_ROLE_REPOSITORY_TOKEN } from "../../storage/canonical/PersonRoleSchema";
import { COMPANY_OBSERVATION_REPOSITORY_TOKEN } from "../../storage/observation/CompanyObservationSchema";
import { CANONICAL_PERSON_REPOSITORY_TOKEN } from "../../storage/canonical/CanonicalPersonSchema";
import { CANONICAL_COMPANY_REPOSITORY_TOKEN } from "../../storage/canonical/CanonicalCompanySchema";
import { PERSON_IDENTITY_LINK_REPOSITORY_TOKEN } from "../../storage/canonical/PersonIdentityLinkSchema";
import { COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN } from "../../storage/canonical/CompanyIdentityLinkSchema";

export interface DbStatusResult {
  readonly entityCount: number;
  readonly filingCount: number;
  readonly factsCount: number;
  readonly processedSubmissions: number;
  readonly processedFacts: number;
  readonly extractorRuns: number;
}

export interface TableStat {
  readonly table: string;
  readonly rows: number;
}

/** A repository whose row count is included in the `db stats` command. */
export interface DbStatsTable {
  readonly table: string;
  readonly token: ServiceToken<{ size(): Promise<number> }>;
}

/** Controls whether database counts may use Postgres catalog estimates. */
export interface DbCountOptions {
  /** Force exact storage-level counts, including on Postgres. */
  readonly exact?: boolean;
}

/**
 * Counts rows in a repository via the storage `size()` method rather than
 * loading every entity with `getAll()`. `cik_names` in particular has ~1M rows,
 * so `getAll()` would be both slow and memory-hungry.
 */
interface CountableRepository {
  size(): Promise<number>;
  isDurable?(): boolean;
}

/**
 * Counts rows through the storage interface. This exact path is used for
 * status metrics and every non-Postgres backend.
 */
async function countRows(
  token: ServiceToken<CountableRepository>
): Promise<number> {
  const repo = globalServiceRegistry.get(token);
  return await repo.size();
}

/**
 * Uses Postgres' live-tuple statistic for a fast, approximate count. SQLite
 * and non-durable test repositories use the exact storage-level count.
 * PostgreSQL updates this statistic through ANALYZE/autovacuum, so it can lag
 * recent writes and must not be used where an exact cardinality is required.
 */
async function countTableRows(
  table: string,
  token: ServiceToken<CountableRepository>,
  exact = false
): Promise<number> {
  const repo = globalServiceRegistry.get(token);
  if (!exact && resolveSqlBackend("read", repo) === "postgres") {
    const result = await getPgPool().query<{ estimated_count: string | number }>(
      `SELECT n_live_tup::bigint AS estimated_count
       FROM pg_stat_user_tables
       WHERE relid = to_regclass($1)`,
      [table]
    );
    const estimated = result.rows[0]?.estimated_count;
    if (estimated !== undefined) return Number(estimated);
  }
  return await countRows(token);
}

const STATUS_TABLES: readonly {
  readonly key: keyof DbStatusResult;
  readonly table: string;
  readonly token: ServiceToken<CountableRepository>;
}[] = [
  { key: "entityCount", table: "entity", token: ENTITY_REPOSITORY_TOKEN as any },
  { key: "filingCount", table: "filing", token: FILING_REPOSITORY_TOKEN as any },
  { key: "factsCount", table: "company_facts", token: COMPANY_FACTS_REPOSITORY_TOKEN as any },
  {
    key: "processedSubmissions",
    table: "processed_submissions",
    token: PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN as any,
  },
  { key: "processedFacts", table: "processed_facts", token: PROCESSED_FACTS_REPOSITORY_TOKEN as any },
  { key: "extractorRuns", table: "extractor_runs", token: EXTRACTOR_RUN_REPOSITORY_TOKEN as any },
];

export async function getDbStatus(options: DbCountOptions = {}): Promise<DbStatusResult> {
  const result = {} as Record<keyof DbStatusResult, number>;
  for (const { key, table, token } of STATUS_TABLES) {
    result[key] = await countTableRows(table, token, options.exact === true);
  }
  return result;
}

const TABLE_TOKENS: readonly DbStatsTable[] = [
  { table: "cik_names", token: CIK_NAME_REPOSITORY_TOKEN as any },
  { table: "entity", token: ENTITY_REPOSITORY_TOKEN as any },
  { table: "filing", token: FILING_REPOSITORY_TOKEN as any },
  { table: "company_facts", token: COMPANY_FACTS_REPOSITORY_TOKEN as any },
  { table: "investment_offering", token: INVESTMENT_OFFERING_REPOSITORY_TOKEN as any },
  { table: "crowdfunding", token: CROWDFUNDING_REPOSITORY_TOKEN as any },
  { table: "address", token: ADDRESS_REPOSITORY_TOKEN as any },
  { table: "phone", token: PHONE_REPOSITORY_TOKEN as any },
  { table: "portal", token: PORTAL_REPOSITORY_TOKEN as any },
  { table: "extractor_runs", token: EXTRACTOR_RUN_REPOSITORY_TOKEN as any },
  { table: "person_observation", token: PERSON_OBSERVATION_REPOSITORY_TOKEN as any },
  { table: "person_observation_titles", token: PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN as any },
  { table: "person_role", token: PERSON_ROLE_REPOSITORY_TOKEN as any },
  { table: "company_observation", token: COMPANY_OBSERVATION_REPOSITORY_TOKEN as any },
  { table: "canonical_person", token: CANONICAL_PERSON_REPOSITORY_TOKEN as any },
  { table: "canonical_company", token: CANONICAL_COMPANY_REPOSITORY_TOKEN as any },
  { table: "person_identity_link", token: PERSON_IDENTITY_LINK_REPOSITORY_TOKEN as any },
  { table: "company_identity_link", token: COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN as any },
  { table: "section16_filings", token: SECTION16_FILING_REPOSITORY_TOKEN as any },
  { table: "section16_transactions", token: SECTION16_TRANSACTION_REPOSITORY_TOKEN as any },
  { table: "section16_holdings", token: SECTION16_HOLDING_REPOSITORY_TOKEN as any },
  { table: "form144_filings", token: FORM144_FILING_REPOSITORY_TOKEN as any },
  { table: "form144_acquisitions", token: FORM144_ACQUISITION_REPOSITORY_TOKEN as any },
  { table: "form144_recent_sales", token: FORM144_RECENT_SALE_REPOSITORY_TOKEN as any },
];

const extensionTableTokens = new Map<string, DbStatsTable>();

/**
 * Adds a downstream package's tables to the standard `db stats` report.
 * Tables are keyed by name so repeated CLI construction remains idempotent.
 */
export function registerDbStatsTables(tables: readonly DbStatsTable[]): void {
  for (const table of tables) {
    if (TABLE_TOKENS.some((builtIn) => builtIn.table === table.table)) {
      throw new Error(`db stats table is already owned by sec: ${table.table}`);
    }
    extensionTableTokens.set(table.table, table);
  }
}

/**
 * Counts each table in order so the task runner can render useful progress
 * while a database with many extension tables is being inspected.
 */
export async function getDbStats(
  onProgress?: (progress: number, message: string) => void | Promise<void>,
  options: DbCountOptions = {}
): Promise<TableStat[]> {
  const tables = [...TABLE_TOKENS, ...extensionTableTokens.values()];
  const results: TableStat[] = [];
  for (const [index, { table, token }] of tables.entries()) {
    const current = index + 1;
    await onProgress?.(
      Math.round((index / tables.length) * 100),
      `counting ${table} (${current}/${tables.length})`
    );
    results.push({ table, rows: await countTableRows(table, token, options.exact === true) });
    await onProgress?.(
      Math.round((current / tables.length) * 100),
      `counted ${table} (${current}/${tables.length})`
    );
  }
  return results;
}
