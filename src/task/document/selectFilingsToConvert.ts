/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  FILING_DOCUMENT_REPOSITORY_TOKEN,
  type FilingDocumentRepositoryStorage,
} from "../../storage/document/FilingDocumentSchema";
import {
  FILING_REPOSITORY_TOKEN,
  type FilingRepositoryStorage,
} from "../../storage/filing/FilingSchema";
import { SPAC_REPOSITORY_TOKEN, type SpacRepositoryStorage } from "../../storage/spac/SpacSchema";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";
import { resolveSqlBackend } from "../../util/sqlBackend";

/**
 * The forms whose narrative body this product actually reads.
 *
 * Not every form, and deliberately so. `filings` is every filing of every
 * seeded CIK — hundreds of thousands of rows, most of them ownership XML and
 * cover-page metadata with no prose in them at all. Converting those would cost
 * a corpus of storage to render pages nobody opens. These are the forms a
 * reader follows a link INTO: the registration and its amendments, the priced
 * prospectus, the merger proxy, and the 8-Ks the lifecycle is built from.
 *
 * Widening this list is the supported way to widen coverage — add a form, run
 * the sweep again, and the filings that were showing an EDGAR link start
 * showing the filing.
 */
export const CONVERTIBLE_FORMS: readonly string[] = [
  "S-1",
  "S-1/A",
  "F-1",
  "F-1/A",
  "DRS",
  "DRS/A",
  "424B1",
  "424B2",
  "424B3",
  "424B4",
  "424B5",
  "424B7",
  "DEFM14A",
  "DEF 14A",
  "8-K",
  "8-K/A",
];

/**
 * The forms only a SPAC's filings are converted for, unless asked otherwise.
 *
 * 8-Ks are in {@link CONVERTIBLE_FORMS} because the SPAC lifecycle is built out
 * of them — the LOI, the definitive agreement, the redemption, the closing. But
 * EVERY reporting company files them, on every earnings release and every
 * material event, and they outnumber the rest of the convertible set by more
 * than an order of magnitude. Converting all of them costs a corpus of markdown
 * to render pages for filers this product has no page for.
 *
 * So the default sweep takes an 8-K only when its filer is in `spac` — the
 * known-SPAC table, not the `spac_candidate` screen: a candidate is a guess and
 * this is the expensive half of the work. `--all-8k` converts them for every
 * filer.
 */
export const SPAC_GATED_FORMS: readonly string[] = ["8-K", "8-K/A"];

/** One filing the sweep should convert. */
export interface FilingToConvert {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly form: string | null;
  readonly primary_doc: string | null;
}

export interface SelectFilingsOptions {
  /** Which forms to consider. Defaults to {@link CONVERTIBLE_FORMS}. */
  readonly forms?: readonly string[];
  /** Only filings on or after this date (YYYY-MM-DD). */
  readonly since?: string | undefined;
  /** Only this CIK. */
  readonly cik?: number | undefined;
  /** Stop after this many. */
  readonly limit: number;
  /**
   * Re-convert filings already stored at the current version.
   *
   * Off by default, which is what makes the sweep resumable: an interrupted run
   * picks up where it stopped rather than starting over.
   */
  readonly force?: boolean;
  /**
   * Convert {@link SPAC_GATED_FORMS} for every filer rather than only for CIKs
   * in `spac`. Off by default — see that constant for why.
   */
  readonly all8k?: boolean;
  /** The stamp a stored row must carry to count as done. */
  readonly converterVersion: string;
}

function filingRepoIfRegistered(): FilingRepositoryStorage | undefined {
  return globalServiceRegistry.has(FILING_REPOSITORY_TOKEN)
    ? globalServiceRegistry.get(FILING_REPOSITORY_TOKEN)
    : undefined;
}

function documentRepoIfRegistered(): FilingDocumentRepositoryStorage | undefined {
  return globalServiceRegistry.has(FILING_DOCUMENT_REPOSITORY_TOKEN)
    ? globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN)
    : undefined;
}

function spacRepoIfRegistered(): SpacRepositoryStorage | undefined {
  return globalServiceRegistry.has(SPAC_REPOSITORY_TOKEN)
    ? globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN)
    : undefined;
}

/**
 * The gated forms this call actually asks for, or none when the gate is off.
 *
 * Computed from the REQUESTED forms rather than applied blanket, so a sweep of
 * registrations pays nothing for a predicate that could not exclude anything.
 */
function gatedFormsInScope(forms: readonly string[], all8k: boolean | undefined): string[] {
  if (all8k === true) return [];
  return forms.filter((form) => SPAC_GATED_FORMS.includes(form));
}

/**
 * Filings of the named forms that have no PRIMARY `filing_document` row at the
 * current converter version.
 *
 * Primary specifically, because a submission stores one row per document and
 * the converter writes the primary LAST. "Has a row" would call a filing done
 * the moment its first exhibit landed, so an interruption between the exhibits
 * and the primary would leave a half-stored submission nothing ever revisits.
 *
 * An anti-join, so it is raw SQL on the two durable backends: set difference
 * across two tables is the one shape `ITabularStorage` cannot express, and the
 * alternative — stream every filing and probe the document table per row — is a
 * round trip per filing over a table with hundreds of thousands of them. A READ,
 * so the dry-run guard does not apply; the repository fallback is still forced
 * whenever a repo is non-durable, because a fast path would otherwise read a
 * real database the caller never populated and report that nothing needs
 * converting.
 *
 * Newest first. A reader following a link is far likelier to want this
 * quarter's S-1 than one from 2014, so an interrupted backfill has still made
 * the pages people open work.
 */
export async function selectFilingsToConvert(
  options: SelectFilingsOptions
): Promise<FilingToConvert[]> {
  const forms = options.forms ?? CONVERTIBLE_FORMS;
  if (forms.length === 0 || options.limit <= 0) return [];

  const filingRepo = filingRepoIfRegistered();
  const documentRepo = documentRepoIfRegistered();
  const spacRepo = spacRepoIfRegistered();
  const gatedForms = gatedFormsInScope(forms, options.all8k);
  // Every table the query reads gates the fast path: any one of them being
  // non-durable makes raw SQL the wrong answer. The `spac` table joins that set
  // only while the gate is live, so a registration-only sweep is unaffected by
  // how the SPAC storage happens to be bound.
  //
  // A gate with no `spac` repository registered at all is not gated — a test
  // wiring up two tables gets the same query it always did, rather than SQL
  // against a table its database never created. Nothing reaches that state in
  // production: `SEC_STORAGE_REGISTRY` binds every token at DI bootstrap.
  const gateActive = gatedForms.length > 0 && spacRepo !== undefined;
  const backend =
    resolveSqlBackend("read", filingRepo) === "repository" ||
    resolveSqlBackend("read", documentRepo) === "repository" ||
    (gateActive && resolveSqlBackend("read", spacRepo) === "repository")
      ? "repository"
      : resolveSqlBackend("read", documentRepo);

  if (backend === "sqlite") {
    const db = getDb();
    // Built in STATEMENT order, because SQLite numbers `?` by position and the
    // version placeholder sits inside the JOIN — ahead of every WHERE
    // parameter. Appending it with the filters would bind the version to the
    // first form and silently return the wrong set.
    const params: (string | number)[] = [options.converterVersion, ...forms];
    const clauses = [`f.\`form\` IN (${forms.map(() => "?").join(", ")})`];
    if (options.since !== undefined) {
      clauses.push("f.`filing_date` >= ?");
      params.push(options.since);
    }
    if (options.cik !== undefined) {
      clauses.push("f.`cik` = ?");
      params.push(options.cik);
    }
    if (options.force !== true) clauses.push("d.`accession_number` IS NULL");
    if (gateActive) {
      // `current_cik` as well as `cik`: a combination that moves the reporting
      // entity to a new CIK files its closing 8-K under that one, and it is the
      // filing the lifecycle most wants. The `spac` row records both.
      clauses.push(
        `(f.\`form\` NOT IN (${gatedForms.map(() => "?").join(", ")})
            OR EXISTS (SELECT 1 FROM \`spac\` s
                        WHERE s.\`cik\` = f.\`cik\` OR s.\`current_cik\` = f.\`cik\`))`
      );
      params.push(...gatedForms);
    }
    params.push(options.limit);
    return db
      .prepare<(string | number)[], FilingToConvert>(
        `SELECT f.\`cik\`, f.\`accession_number\`, f.\`filing_date\`, f.\`form\`, f.\`primary_doc\`
           FROM \`filings\` f
           LEFT JOIN \`filing_document\` d
             ON d.\`cik\` = f.\`cik\`
            AND d.\`accession_number\` = f.\`accession_number\`
            AND d.\`converter_version\` = ?
            AND d.\`is_primary\` = 1
          WHERE ${clauses.join(" AND ")}
          ORDER BY f.\`filing_date\` DESC, f.\`accession_number\` DESC
          LIMIT ?`
      )
      .all(...params);
  }

  if (backend === "postgres") {
    const pool = getPgPool();
    const params: (string | number | string[])[] = [options.converterVersion, [...forms]];
    const clauses = [`f."form" = ANY($2)`];
    if (options.since !== undefined) {
      params.push(options.since);
      clauses.push(`f."filing_date" >= $${params.length}`);
    }
    if (options.cik !== undefined) {
      params.push(options.cik);
      clauses.push(`f."cik" = $${params.length}`);
    }
    if (options.force !== true) clauses.push(`d."accession_number" IS NULL`);
    if (gateActive) {
      // See the SQLite branch for why `current_cik` counts too.
      params.push([...gatedForms]);
      clauses.push(
        `(f."form" <> ALL($${params.length})
            OR EXISTS (SELECT 1 FROM "spac" s
                        WHERE s."cik" = f."cik" OR s."current_cik" = f."cik"))`
      );
    }
    params.push(options.limit);
    const res = await pool.query<FilingToConvert>(
      `SELECT f."cik", f."accession_number", f."filing_date", f."form", f."primary_doc"
         FROM "filings" f
         LEFT JOIN "filing_document" d
           ON d."cik" = f."cik"
          AND d."accession_number" = f."accession_number"
          AND d."converter_version" = $1
          AND d."is_primary" = true
        WHERE ${clauses.join(" AND ")}
        ORDER BY f."filing_date" DESC, f."accession_number" DESC
        LIMIT $${params.length}`,
      params
    );
    return res.rows.map((row) => ({ ...row, cik: Number(row.cik) }));
  }

  // Repository fallback (tests / in-memory backend). Streams filings and probes
  // the document table per candidate, which is the round trip the fast paths
  // exist to avoid — acceptable only because this branch is reached on small
  // datasets by construction.
  const repo = filingRepo ?? globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const documents = documentRepo ?? globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN);
  const formSet = new Set(forms);
  const gatedSet = new Set(gatedForms);
  // Materialized once rather than probed per filing: `spac` is the smallest of
  // the three tables by orders of magnitude, and this path already streams every
  // filing, so a lookup per row is the cost worth avoiding.
  const spacCiks = new Set<number>();
  if (gateActive && spacRepo !== undefined) {
    for await (const spac of spacRepo.records(1000)) {
      spacCiks.add(Number(spac.cik));
      if (spac.current_cik !== null && spac.current_cik !== undefined) {
        spacCiks.add(Number(spac.current_cik));
      }
    }
  }
  const matches: FilingToConvert[] = [];
  for await (const filing of repo.records(1000)) {
    if (filing.form === null || !formSet.has(filing.form)) continue;
    if (options.since !== undefined && (filing.filing_date ?? "") < options.since) continue;
    if (options.cik !== undefined && Number(filing.cik) !== options.cik) continue;
    if (gatedSet.has(filing.form) && !spacCiks.has(Number(filing.cik))) continue;
    matches.push({
      cik: Number(filing.cik),
      accession_number: filing.accession_number,
      filing_date: filing.filing_date,
      form: filing.form,
      primary_doc: filing.primary_doc ?? null,
    });
  }
  matches.sort((a, b) => {
    const byDate = (b.filing_date ?? "").localeCompare(a.filing_date ?? "");
    return byDate !== 0 ? byDate : b.accession_number.localeCompare(a.accession_number);
  });

  const selected: FilingToConvert[] = [];
  for (const filing of matches) {
    if (selected.length >= options.limit) break;
    if (options.force !== true) {
      // `doc_file` joined the primary key, so this is a query rather than a
      // `get`: what decides "done" is whether the PRIMARY row is present at the
      // current version, and its filename is not known here.
      const existing = await documents.query({
        cik: filing.cik,
        accession_number: filing.accession_number,
      } as never);
      const done = (existing ?? []).some(
        (row) => row.is_primary && row.converter_version === options.converterVersion
      );
      if (done) continue;
    }
    selected.push(filing);
  }
  return selected;
}
