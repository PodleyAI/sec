import type { ServiceToken } from "workglow";
import { globalServiceRegistry } from "workglow";
import { SEC_STORAGE_REGISTRY } from "../../config/storageRegistry";
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
  /**
   * Row count, or `null` when the relation does not exist yet — a registered
   * table the database has not been `db setup` for. Every other failure still
   * throws.
   */
  readonly rows: number | null;
}

/**
 * Counts rows in a repository via the storage `size()` method rather than
 * loading every entity with `getAll()`. `cik_names` in particular has ~1M rows,
 * so `getAll()` would be both slow and memory-hungry.
 *
 * Every `*_REPOSITORY_TOKEN` satisfies this structurally — `ITabularStorage`
 * declares both members — and `ServiceToken` holds its service type in a
 * readonly position, so a concrete repository token is assignable here with no
 * cast.
 */
export interface CountableRepository {
  size(): Promise<number>;
  isDurable?(): boolean;
}

/** A repository whose row count is included in the `db stats` command. */
export interface DbStatsTable {
  readonly table: string;
  readonly token: ServiceToken<CountableRepository>;
}

/** Controls whether database counts may use Postgres catalog estimates. */
export interface DbCountOptions {
  /** Force exact storage-level counts, including on Postgres. */
  readonly exact?: boolean;
}

/**
 * Physical table name per repository token, read from the same registry
 * `createStorage` builds the tables from. The estimate query needs the real
 * relation name — `to_regclass` returns NULL for a name no relation has, the
 * row filter then matches nothing, and the count silently falls back to the
 * exact scan the estimate exists to avoid. Deriving the name instead of
 * repeating it here is what stops a hand-written label (`entity` for
 * `entities`, `filing` for `filings`) from reintroducing that.
 */
const TABLE_NAME_BY_TOKEN_ID: ReadonlyMap<string, string> = new Map(
  SEC_STORAGE_REGISTRY.map((storage) => [storage.token.id, storage.table])
);

/**
 * Physical table name for a repository sec owns. Throws rather than guessing:
 * a token missing from the registry is a wiring mistake, and falling back to
 * the token id would silently reinstate the exact-count path.
 */
function secTableName(token: ServiceToken<CountableRepository>): string {
  const table = TABLE_NAME_BY_TOKEN_ID.get(token.id);
  if (table === undefined) {
    throw new Error(`db stats token is not in the storage registry: ${token.id}`);
  }
  return table;
}

/** Postgres SQLSTATE for `undefined_table`. */
const POSTGRES_UNDEFINED_TABLE = "42P01";
/** `SQLITE_ERROR: no such table: adv_landing_replacement` */
const SQLITE_MISSING_TABLE = /no such table:/i;
/** `error: relation "adv_landing_replacement" does not exist` */
const POSTGRES_MISSING_RELATION = /relation\s+"[^"]*"\s+does not exist/i;

/**
 * True only for "this relation has not been created", the one failure `db
 * stats` degrades on — a table registered through {@link registerDbStatsTables}
 * (or a sec built-in) in a database that has not been `db setup` since it was
 * added. Deliberately narrow: a connection failure, a permissions error or a
 * corrupt file must still surface loudly rather than be reported as `n/a`.
 */
export function isMissingRelationError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  if ((err as { code?: unknown }).code === POSTGRES_UNDEFINED_TABLE) return true;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return SQLITE_MISSING_TABLE.test(message) || POSTGRES_MISSING_RELATION.test(message);
}

/**
 * Counts rows through the storage interface. This exact path is used for
 * status metrics and every non-Postgres backend.
 */
async function countRows(token: ServiceToken<CountableRepository>): Promise<number> {
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

/**
 * {@link countTableRows}, degrading to `null` when the relation does not exist.
 * `db stats` counts tables a downstream package registered as well as sec's
 * own, and a database set up before one of them was added has no such
 * relation — counting it must not cost the operator every other row count in
 * the report. Only a missing relation degrades; every other error rethrows.
 *
 * Both backends funnel through here: on Postgres a name no relation has makes
 * `to_regclass` NULL, the estimate matches no row, and the exact
 * {@link countRows} call below it raises `42P01`.
 */
async function countTableRowsOrNull(
  table: string,
  token: ServiceToken<CountableRepository>,
  exact: boolean
): Promise<number | null> {
  try {
    return await countTableRows(table, token, exact);
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

const STATUS_TABLES: readonly {
  readonly key: keyof DbStatusResult;
  readonly token: ServiceToken<CountableRepository>;
}[] = [
  { key: "entityCount", token: ENTITY_REPOSITORY_TOKEN },
  { key: "filingCount", token: FILING_REPOSITORY_TOKEN },
  { key: "factsCount", token: COMPANY_FACTS_REPOSITORY_TOKEN },
  { key: "processedSubmissions", token: PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN },
  { key: "processedFacts", token: PROCESSED_FACTS_REPOSITORY_TOKEN },
  { key: "extractorRuns", token: EXTRACTOR_RUN_REPOSITORY_TOKEN },
];

export async function getDbStatus(options: DbCountOptions = {}): Promise<DbStatusResult> {
  const result = {} as Record<keyof DbStatusResult, number>;
  for (const { key, token } of STATUS_TABLES) {
    result[key] = await countTableRows(secTableName(token), token, options.exact === true);
  }
  return result;
}

/**
 * Repositories counted by `db stats`, in report order. Each table name is
 * derived from the storage registry via {@link secTableName}, so the report
 * names the relation a `psql \dt` would show and the estimate query can find it.
 */
const BUILT_IN_TABLE_TOKENS: readonly ServiceToken<CountableRepository>[] = [
  CIK_NAME_REPOSITORY_TOKEN,
  ENTITY_REPOSITORY_TOKEN,
  FILING_REPOSITORY_TOKEN,
  COMPANY_FACTS_REPOSITORY_TOKEN,
  INVESTMENT_OFFERING_REPOSITORY_TOKEN,
  CROWDFUNDING_REPOSITORY_TOKEN,
  ADDRESS_REPOSITORY_TOKEN,
  PHONE_REPOSITORY_TOKEN,
  PORTAL_REPOSITORY_TOKEN,
  EXTRACTOR_RUN_REPOSITORY_TOKEN,
  PERSON_OBSERVATION_REPOSITORY_TOKEN,
  PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
  PERSON_ROLE_REPOSITORY_TOKEN,
  COMPANY_OBSERVATION_REPOSITORY_TOKEN,
  CANONICAL_PERSON_REPOSITORY_TOKEN,
  CANONICAL_COMPANY_REPOSITORY_TOKEN,
  PERSON_IDENTITY_LINK_REPOSITORY_TOKEN,
  COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN,
  SECTION16_FILING_REPOSITORY_TOKEN,
  SECTION16_TRANSACTION_REPOSITORY_TOKEN,
  SECTION16_HOLDING_REPOSITORY_TOKEN,
  FORM144_FILING_REPOSITORY_TOKEN,
  FORM144_ACQUISITION_REPOSITORY_TOKEN,
  FORM144_RECENT_SALE_REPOSITORY_TOKEN,
];

const TABLE_TOKENS: readonly DbStatsTable[] = BUILT_IN_TABLE_TOKENS.map((token) => ({
  table: secTableName(token),
  token,
}));

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
 * Clears the extension tables {@link registerDbStatsTables} collected.
 * Registration is process-global, so a test that registers a table would
 * otherwise change what every later `db stats` assertion in the same process
 * sees (the report order, its length, and which table is counted last).
 */
export function resetDbStatsTablesForTesting(): void {
  extensionTableTokens.clear();
}

/**
 * Counts each table in order so the task runner can render useful progress
 * while a database with many extension tables is being inspected. A table the
 * database has not created reports `rows: null` (rendered `n/a`) instead of
 * failing the whole report — see {@link countTableRowsOrNull}.
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
    results.push({ table, rows: await countTableRowsOrNull(table, token, options.exact === true) });
    await onProgress?.(
      Math.round((current / tables.length) * 100),
      `counted ${table} (${current}/${tables.length})`
    );
  }
  return results;
}
