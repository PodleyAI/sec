import type { ServiceToken } from "workglow";
import { globalServiceRegistry } from "workglow";
import { SEC_STORAGE_REGISTRY } from "../../config/storageRegistry";
import { CIK_NAME_REPOSITORY_TOKEN } from "../../storage/entity/CikNameSchema";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../../storage/facts/CompanyFactsSchema";
import { FILING_DOCUMENT_REPOSITORY_TOKEN } from "../../storage/document/FilingDocumentSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedFactsSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { getPgPool } from "../../util/pg";
import { resolveSqlBackend } from "../../util/sqlBackend";

/** The headline counts, without the reporting metadata beside them. */
export interface DbStatusCounts {
  readonly entityCount: number;
  readonly filingCount: number;
  readonly factsCount: number;
  readonly processedSubmissions: number;
  readonly processedFacts: number;
  readonly documentCount: number;
}

export interface DbStatusResult extends DbStatusCounts {
  /**
   * True when ANY of the counts above is a Postgres `n_live_tup` estimate
   * rather than an exact count. The estimate lags recent writes, so a report
   * that does not say which number it is showing invites an operator to read a
   * stale statistic as a real count.
   */
  readonly estimated: boolean;
}

export interface TableStat {
  readonly table: string;
  /**
   * Row count, or `null` when the relation does not exist yet — a registered
   * table the database has not been `db setup` for. Every other failure still
   * throws.
   */
  readonly rows: number | null;
  /** True when `rows` is a Postgres `n_live_tup` estimate, not an exact count. */
  readonly estimated: boolean;
}

/** A count paired with whether it came from the Postgres catalog estimate. */
interface CountedRows {
  readonly rows: number;
  readonly estimated: boolean;
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

/** Postgres SQLSTATE for `undefined_table`. */
const POSTGRES_UNDEFINED_TABLE = "42P01";
/** `SQLITE_ERROR: no such table: adv_landing_replacement` */
const SQLITE_MISSING_TABLE = /no such table:/i;
/** `error: relation "adv_landing_replacement" does not exist` */
const POSTGRES_MISSING_RELATION = /relation\s+"[^"]*"\s+does not exist/i;

/**
 * True only for "this relation has not been created", the one failure `db
 * stats` degrades on — a table in a database that has not been `db setup`
 * since it was added. Deliberately narrow: a connection failure, a permissions error or a
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
 *
 * Two things the naive form of this query gets wrong:
 *
 * - **An unqualified name resolves through `search_path`.** `to_regclass
 *   ('filings')` binds whichever schema comes first on the session's
 *   `search_path`, so a deployment whose path lists a staging schema ahead of
 *   sec's would report the OTHER schema's row count under sec's table name.
 *   The name is qualified to `current_schema()` for the same reason
 *   `resetAllDatabases` qualifies its drops. `quote_ident` keeps it
 *   parameterized — the table name stays a bind value, never interpolated SQL.
 * - **A zero estimate is almost never a real zero.** `n_live_tup` is 0 until
 *   the first ANALYZE, so right after `sec bootstrap` bulk-loads ~1M
 *   `cik_names` and before autovacuum catches up, the estimate reports 0 for a
 *   table with a million rows. Zero therefore means "no statistics yet" and
 *   falls back to the exact count; a genuinely empty table pays one cheap
 *   `COUNT(*)` for that.
 */
async function countTableRows(
  table: string,
  token: ServiceToken<CountableRepository>,
  exact = false
): Promise<CountedRows> {
  const repo = globalServiceRegistry.get(token);
  if (!exact && resolveSqlBackend("read", repo) === "postgres") {
    const result = await getPgPool().query<{ estimated_count: string | number }>(
      `SELECT n_live_tup::bigint AS estimated_count
       FROM pg_stat_user_tables
       WHERE relid = to_regclass(quote_ident(current_schema()) || '.' || quote_ident($1))`,
      [table]
    );
    const estimated = result.rows[0]?.estimated_count;
    if (estimated !== undefined && Number(estimated) > 0) {
      return { rows: Number(estimated), estimated: true };
    }
  }
  return { rows: await countRows(token), estimated: false };
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
): Promise<CountedRows | null> {
  try {
    return await countTableRows(table, token, exact);
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

const STATUS_TABLES: readonly {
  readonly key: keyof DbStatusCounts;
  readonly table: string;
  readonly token: ServiceToken<CountableRepository>;
}[] = [
  { key: "entityCount", table: "entities", token: ENTITY_REPOSITORY_TOKEN },
  { key: "filingCount", table: "filings", token: FILING_REPOSITORY_TOKEN },
  { key: "factsCount", table: "company_facts", token: COMPANY_FACTS_REPOSITORY_TOKEN },
  {
    key: "processedSubmissions",
    table: "processed_submissions",
    token: PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN,
  },
  { key: "processedFacts", table: "processed_facts", token: PROCESSED_FACTS_REPOSITORY_TOKEN },
  { key: "documentCount", table: "filing_document", token: FILING_DOCUMENT_REPOSITORY_TOKEN },
];

export async function getDbStatus(options: DbCountOptions = {}): Promise<DbStatusResult> {
  const counts = {} as Record<keyof DbStatusCounts, number>;
  let estimated = false;
  for (const { key, table, token } of STATUS_TABLES) {
    const counted = await countTableRows(table, token, options.exact === true);
    counts[key] = counted.rows;
    estimated ||= counted.estimated;
  }
  return { ...counts, estimated };
}

/**
 * Every table `db stats` counts, in the storage registry's declaration order.
 *
 * Derived rather than listed: the report has to name the PHYSICAL relation
 * (`entities`, not `entity`), because the Postgres estimate path filters on
 * `relid = to_regclass($1)` and a display label matches nothing — the count
 * then silently falls back to the exact scan the estimate exists to avoid.
 */
const TABLE_TOKENS: readonly DbStatsTable[] = SEC_STORAGE_REGISTRY.map((storage) => ({
  table: storage.table,
  token: storage.token as unknown as ServiceToken<CountableRepository>,
}));

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
  const tables = TABLE_TOKENS;
  const results: TableStat[] = [];
  for (const [index, { table, token }] of tables.entries()) {
    const current = index + 1;
    await onProgress?.(
      Math.round((index / tables.length) * 100),
      `counting ${table} (${current}/${tables.length})`
    );
    const counted = await countTableRowsOrNull(table, token, options.exact === true);
    results.push({
      table,
      rows: counted?.rows ?? null,
      estimated: counted?.estimated ?? false,
    });
    await onProgress?.(
      Math.round((current / tables.length) * 100),
      `counted ${table} (${current}/${tables.length})`
    );
  }
  return results;
}
