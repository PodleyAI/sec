/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { ENTITY_HISTORY_REPOSITORY_TOKEN } from "../../storage/entity/EntityHistorySchema";
import {
  ENTITY_REPOSITORY_TOKEN,
  type EntityRepositoryStorage,
} from "../../storage/entity/EntitySchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { S1_CLASSIFICATION_REPOSITORY_TOKEN } from "../../storage/classification/S1ClassificationSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";
import { resolveSqlBackend } from "../../util/sqlBackend";
import {
  BLANK_CHECK_NAME_EXCLUSIONS,
  BLANK_CHECK_NAME_PATTERNS,
  BLANK_CHECK_SIC,
  looksLikeSpacName,
  MODERN_SPAC_NAME_PATTERNS,
  SPAC_REGISTRATION_FORMS,
  type SpacCandidateFacts,
} from "./classifySpacCandidate";

/**
 * The registered entity repo, when there is one. Handed to `resolveSqlBackend`
 * so a non-durable (in-memory) binding forces the repository scan even under a
 * `SEC_DB_TYPE` that would otherwise select a raw-SQL path — the fast path
 * would read a real database the caller never populated and report no
 * candidates. Also the destination of that scan, so it is resolved once per
 * call.
 */
function entityRepoIfRegistered(): EntityRepositoryStorage | undefined {
  return globalServiceRegistry.has(ENTITY_REPOSITORY_TOKEN)
    ? globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN)
    : undefined;
}

export interface ScanOptions {
  /**
   * Incremental watermark (YYYY-MM-DD): consider only CIKs whose submissions
   * were (re)processed on or after this date. Omit for a full scan.
   */
  readonly since?: string;
}

/** `max(valid_to)` comes back as a Date from pg and as text from SQLite. */
function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return text === "" ? null : text;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTextOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === "" ? null : text;
}

/**
 * Builds the scan statement for one SQL dialect.
 *
 * Fragments are appended to `params` in the order they appear in the finished
 * statement, because SQLite binds `?` positionally — so the SELECT-list
 * subqueries must contribute their parameters before the WHERE clause does.
 * Name patterns and form names are always bound, never interpolated: they are
 * compared against filer-controlled columns.
 */
function buildScanSql(
  options: ScanOptions,
  quote: (identifier: string) => string,
  placeholder: (index: number) => string
): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = [];
  const bind = (value: string | number): string => {
    params.push(value);
    return placeholder(params.length);
  };
  // Mirrors `looksLikeSpacName`: cast the net over both naming classes, then
  // reject the partnership/LLC vocabulary that marks an LBO vehicle rather than
  // a SPAC. The classifier re-derives which class matched, since only the
  // strong one can carry `high`.
  const nameLike = (column: string): string => {
    const included = [...BLANK_CHECK_NAME_PATTERNS, ...MODERN_SPAC_NAME_PATTERNS]
      .map((p) => `lower(${column}) LIKE ${bind(p)}`)
      .join(" OR ");
    const excluded = BLANK_CHECK_NAME_EXCLUSIONS.map(
      (p) => `lower(${column}) NOT LIKE ${bind(p)}`
    ).join(" AND ");
    return `(${included}) AND (${excluded})`;
  };
  const q = quote;

  // --- SELECT list (parameters bind first) ---
  const regForms1 = SPAC_REGISTRATION_FORMS.map((f) => bind(f)).join(", ");
  const firstRegDate = `(SELECT f.${q("filing_date")} FROM ${q("filings")} f
        WHERE f.${q("cik")} = e.${q("cik")} AND f.${q("form")} IN (${regForms1})
        ORDER BY f.${q("filing_date")}, f.${q("form")} LIMIT 1)`;
  const regForms2 = SPAC_REGISTRATION_FORMS.map((f) => bind(f)).join(", ");
  const firstRegForm = `(SELECT f.${q("form")} FROM ${q("filings")} f
        WHERE f.${q("cik")} = e.${q("cik")} AND f.${q("form")} IN (${regForms2})
        ORDER BY f.${q("filing_date")}, f.${q("form")} LIMIT 1)`;
  // 1 / 0 / NULL: whether any registration of this filer that the forms pipeline
  // has PARSED carried a 6770 header SIC, or NULL when none has been parsed.
  // Null is not false — it means the question has not been asked yet.
  //
  // Read from `s1_classification`, which is where the as-filed header SIC
  // already lands: `processFormS1` writes the value it parsed out of the SGML
  // header to `sic` on every registration it processes. No second copy, and no
  // column on `filings` for ingest to overwrite with null on the next
  // submissions refresh.
  const filedSic6770 = `(SELECT max(CASE WHEN c.${q("sic")} = ${bind(BLANK_CHECK_SIC)}
          THEN 1 ELSE 0 END)
        FROM ${q("s1_classification")} c
        WHERE c.${q("cik")} = e.${q("cik")} AND c.${q("sic")} IS NOT NULL)`;
  const renamedFrom = `(SELECT h2.${q("name")} FROM ${q("entities_history")} h2
        WHERE h2.${q("cik")} = e.${q("cik")} AND (${nameLike(`h2.${q("name")}`)})
        ORDER BY h2.${q("valid_from")} LIMIT 1)`;
  // The LAST blank-check-named interval, not the first: EDGAR records cosmetic
  // variants ("Corp." -> "Corp") as separate intervals and the earliest one
  // ends while the company is still a SPAC.
  const spacNameEnded = `(SELECT max(h3.${q("valid_to")}) FROM ${q("entities_history")} h3
        WHERE h3.${q("cik")} = e.${q("cik")} AND (${nameLike(`h3.${q("name")}`)})
          AND h3.${q("valid_to")} IS NOT NULL)`;

  // --- WHERE clause ---
  const sicMatch = `e.${q("sic")} = ${bind(BLANK_CHECK_SIC)}`;
  const entityNameMatch = nameLike(`e.${q("name")}`);
  const historyNameMatch = `EXISTS (SELECT 1 FROM ${q("entities_history")} h
        WHERE h.${q("cik")} = e.${q("cik")} AND (${nameLike(`h.${q("name")}`)}))`;
  const sinceClause =
    options.since === undefined
      ? ""
      : `AND EXISTS (SELECT 1 FROM ${q("processed_submissions")} ps
        WHERE ps.${q("cik")} = e.${q("cik")} AND ps.${q("last_processed")} >= ${bind(options.since)})`;

  // A completed de-SPAC matches none of the other three predicates — it recoded
  // and renamed — so the as-filed header is the only thing left that remembers.
  const filedSicMatch = `EXISTS (SELECT 1 FROM ${q("s1_classification")} c2
        WHERE c2.${q("cik")} = e.${q("cik")} AND c2.${q("sic")} = ${bind(BLANK_CHECK_SIC)})`;

  const sql = `
    SELECT e.${q("cik")} AS cik, e.${q("name")} AS name, e.${q("sic")} AS sic,
      ${firstRegDate} AS first_reg_date,
      ${firstRegForm} AS first_reg_form,
      ${renamedFrom} AS renamed_from,
      ${filedSic6770} AS filed_sic_6770,
      ${spacNameEnded} AS spac_name_ended
    FROM ${q("entities")} e
    WHERE (${sicMatch} OR (${entityNameMatch}) OR ${historyNameMatch} OR ${filedSicMatch})
    ${sinceClause}
  `;
  return { sql, params };
}

function rowToFacts(row: Record<string, unknown>): SpacCandidateFacts {
  return {
    cik: Number(row.cik),
    name: toTextOrNull(row.name),
    current_sic: toNumberOrNull(row.sic),
    first_reg_form: toTextOrNull(row.first_reg_form),
    first_reg_date: toTextOrNull(row.first_reg_date),
    renamed_from: toTextOrNull(row.renamed_from),
    filed_sic_6770: row.filed_sic_6770 == null ? null : Number(row.filed_sic_6770) === 1,
    spac_name_ended: toIsoOrNull(row.spac_name_ended),
  };
}

/**
 * Collects the per-CIK facts {@link classifySpacCandidate} grades: every entity
 * that is coded a blank check, is *named* like one, or ever *was* named like
 * one — each with its earliest Securities Act registration and the end of its
 * blank-check-named era.
 *
 * The candidate filter runs in the database rather than over a stream of all
 * ~1M entities; the per-candidate registration lookups ride the
 * `filings(form, cik)` index.
 */
export async function scanSpacCandidates(options: ScanOptions = {}): Promise<SpacCandidateFacts[]> {
  const entityRepo = entityRepoIfRegistered();
  // `access: "read"` — a scan commits nothing, so it keeps its fast path under
  // `--dry-run` rather than streaming every entity through the repository.
  const backend = resolveSqlBackend("read", entityRepo);

  if (backend === "postgres") {
    const { sql, params } = buildScanSql(
      options,
      (id) => `"${id}"`,
      (i) => `$${i}`
    );
    const res = await getPgPool().query(sql, params);
    return (res.rows as Record<string, unknown>[]).map(rowToFacts);
  }

  if (backend === "sqlite") {
    const { sql, params } = buildScanSql(
      options,
      (id) => `\`${id}\``,
      () => "?"
    );
    const rows = getDb()
      .prepare<(string | number)[], Record<string, unknown>>(sql)
      .all(...params);
    return rows.map(rowToFacts);
  }

  return scanRepository(options, entityRepo);
}

/**
 * Repository fallback (tests / in-memory backend): stream entities and resolve
 * each candidate through the repositories. Only ever runs on small datasets —
 * the production paths above push the whole scan into SQL.
 *
 * Also the JS twin that `spacCandidateScan.sqlite.test.ts` compares
 * {@link buildScanSql} against: the two must agree row for row on the same
 * seeded data, which is what keeps the hand-written SQL honest.
 */
/**
 * Whether any PARSED registration carried a 6770 header SIC — null when none
 * has been parsed, which is a different answer from false.
 */
function filedSic6770(classifications: readonly { sic: number | null }[]): boolean | null {
  const parsed = classifications.filter((c) => c.sic !== null);
  if (parsed.length === 0) return null;
  return parsed.some((c) => c.sic === BLANK_CHECK_SIC);
}

export async function scanRepository(
  options: ScanOptions,
  repo?: EntityRepositoryStorage
): Promise<SpacCandidateFacts[]> {
  const entityRepo = repo ?? globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
  const historyRepo = globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN);
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const classificationRepo = globalServiceRegistry.get(S1_CLASSIFICATION_REPOSITORY_TOKEN);
  const processedRepo = globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN);
  const registrationForms = new Set<string>(SPAC_REGISTRATION_FORMS);

  const facts: SpacCandidateFacts[] = [];
  for await (const entity of entityRepo.records(1000)) {
    const history = (await historyRepo.query({ cik: entity.cik })) ?? [];
    const blankCheckHistory = history.filter((h) => looksLikeSpacName(h.name));
    const classifications = (await classificationRepo.query({ cik: entity.cik })) ?? [];
    const filedSic = filedSic6770(classifications);
    const isCandidate =
      entity.sic === BLANK_CHECK_SIC ||
      looksLikeSpacName(entity.name) ||
      blankCheckHistory.length > 0 ||
      filedSic === true;
    if (!isCandidate) continue;

    if (options.since !== undefined) {
      const processed = await processedRepo.get({ cik: entity.cik });
      if (!processed || processed.last_processed < options.since) continue;
    }

    const registrations = ((await filingRepo.query({ cik: entity.cik })) ?? [])
      .filter((f) => f.form !== null && registrationForms.has(f.form))
      .sort((a, b) =>
        a.filing_date === b.filing_date
          ? (a.form ?? "").localeCompare(b.form ?? "")
          : a.filing_date.localeCompare(b.filing_date)
      );

    const renamedFrom = [...blankCheckHistory].sort((a, b) =>
      a.valid_from.localeCompare(b.valid_from)
    )[0];
    const endings = blankCheckHistory
      .map((h) => h.valid_to)
      .filter((v): v is string => v !== null && v !== undefined)
      .sort();

    facts.push({
      cik: entity.cik,
      name: entity.name ?? null,
      current_sic: entity.sic ?? null,
      first_reg_form: registrations[0]?.form ?? null,
      first_reg_date: registrations[0]?.filing_date ?? null,
      renamed_from: renamedFrom?.name ?? null,
      filed_sic_6770: filedSic,
      spac_name_ended: endings.length > 0 ? endings[endings.length - 1] : null,
    });
  }
  return facts;
}
