/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import type { Entity } from "../../storage/entity/EntitySchema";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import type { EntityHistory } from "../../storage/entity/EntityHistorySchema";
import { ENTITY_HISTORY_REPOSITORY_TOKEN } from "../../storage/entity/EntityHistorySchema";
import type { Filing } from "../../storage/filing/FilingSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { S1_CLASSIFICATION_REPOSITORY_TOKEN } from "../../storage/classification/S1ClassificationSchema";
import type { S1Classification } from "../../storage/classification/S1ClassificationSchema";
import { getDb } from "../../util/db";
import { classifySpacCandidate, type SpacCandidateFacts } from "./classifySpacCandidate";
import { buildScanSql, scanRepository, scanSpacCandidates } from "./spacCandidateScan";

const TEST_DB_NAME = "spac_candidate_scan_sqlite_test";
const AT = "2026-08-02T12:00:00.000Z";

const entity = (cik: number, name: string, sic: number | null): Entity => ({
  cik,
  name,
  type: null,
  sic,
  ein: null,
  description: null,
  website: null,
  investor_website: null,
  category: null,
  fiscal_year: null,
  state_incorporation: null,
  state_incorporation_desc: null,
});

const history = (
  cik: number,
  name: string,
  valid_from: string,
  valid_to: string | null
): EntityHistory => ({
  cik,
  valid_from,
  valid_to,
  name,
  type: null,
  sic: null,
  ein: null,
  description: null,
  website: null,
  investor_website: null,
  category: null,
  fiscal_year: null,
  state_incorporation: null,
  state_incorporation_desc: null,
  change_source: "SUBMISSION_UPDATE",
  change_date: valid_from,
});

const filing = (cik: number, form: string, filing_date: string, seq: number): Filing => ({
  cik,
  accession_number: `0000000000-00-${String(seq).padStart(6, "0")}`,
  filing_date,
  report_date: null,
  acceptance_date: `${filing_date}T00:00:00.000Z`,
  form,
  file_number: null,
  film_number: null,
  primary_doc: "doc.htm",
  primary_doc_description: null,
  size: null,
  is_xbrl: null,
  is_inline_xbrl: null,
  items: null,
  act: null,
});

const classification = (cik: number, seq: number, sic: number | null): S1Classification => ({
  extractor_id: "S-1",
  accession_number: `0000000000-99-${String(seq).padStart(6, "0")}`,
  cik,
  sic,
  sic_description: null,
  is_spac: sic === 6770,
  classifier_source: "sgml-header",
  created_at: AT,
});

function byCik(facts: SpacCandidateFacts[]): SpacCandidateFacts[] {
  return [...facts].sort((a, b) => a.cik - b.cik);
}

/**
 * Pins the hand-written `buildScanSql` against `scanRepository`, its JS twin.
 * The two implementations must agree row for row on the same seeded data — the
 * SQL is dual-dialect, deeply subqueried and binds its parameters positionally,
 * so a drift between them (or a binding-order slip) is otherwise invisible until
 * production.
 *
 * Each fixture pins a distinct fragment; see the comment on each seed. Not
 * covered here: `toIsoOrNull`'s Postgres branch, which converts a `Date` from
 * pg. On SQLite `valid_to` comes back as the stored TEXT, identical to what the
 * repository twin reads, so both paths exercise the string branch only.
 */
describe("scanSpacCandidates (sqlite) vs the repository twin", () => {
  withSqliteDb(TEST_DB_NAME, [
    ENTITY_REPOSITORY_TOKEN,
    ENTITY_HISTORY_REPOSITORY_TOKEN,
    FILING_REPOSITORY_TOKEN,
    PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN,
    S1_CLASSIFICATION_REPOSITORY_TOKEN,
  ]);

  async function seed(): Promise<void> {
    const entities = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
    const histories = globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN);
    const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const processed = globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN);

    // 1 — sicMatch + entityNameMatch, and both registration subqueries: the
    // 10-K must be excluded from `first_reg_form`/`first_reg_date` even though
    // it is this CIK's only other filing. `first_reg_form === "S-1"` is the
    // direct catch for a parameter-binding-order slip between the two
    // subqueries, which would otherwise silently swap form and date.
    await entities.put(entity(1, "Alpha Acquisition Corp", 6770));
    await filings.put(filing(1, "S-1", "2021-01-05", 1));
    await filings.put(filing(1, "10-K", "2022-03-01", 2));

    // 2 — historyNameMatch + renamedFrom + spacNameEnded: a de-SPAC whose
    // current name and SIC carry no trace of the blank check.
    await entities.put(entity(2, "Renovacor, Inc.", 2836));
    await histories.put(
      history(2, "Chardan Healthcare Acquisition 2 Corp", "2019-01-01", "2021-09-02")
    );

    // 3 — max(valid_to) must skip the OPEN current row: an earlier closed
    // interval plus a still-open one. End-to-end regression for the classifier
    // branch order (the registration postdates the closed interval, yet the
    // current name still matches).
    await entities.put(entity(3, "Ajax Acquisition Corp", 7389));
    await histories.put(history(3, "Ajax Capital Acquisitions Corp", "2020-01-01", "2021-01-15"));
    await histories.put(history(3, "Ajax Acquisition Corp", "2021-01-15", null));
    await filings.put(filing(3, "S-1", "2021-06-01", 3));

    // 4 — the NOT LIKE exclusions: an LLC holding vehicle that matches
    // `%acquisition%` but must not appear at all.
    await entities.put(entity(4, "Inergy Acquisition Company, LLC", null));
    await filings.put(filing(4, "S-1", "2021-03-01", 4));

    // 5 — negative control: matches nothing.
    await entities.put(entity(5, "Apple Inc.", 3571));
    await filings.put(filing(5, "S-1", "2021-04-01", 5));

    // 6 — MODERN_SPAC_NAME_PATTERNS (weak class) with a DRS registration and no
    // SIC at all.
    await entities.put(entity(6, "Foo Capital Corp", null));
    await filings.put(filing(6, "DRS", "2021-02-01", 6));

    // 7 — the `--since` variant: excluded by an old `last_processed`.
    await entities.put(entity(7, "Beta Acquisition Corp", 6770));
    await filings.put(filing(7, "S-1", "2021-05-01", 7));
    await processed.put({ cik: 7, last_processed: "2020-01-01", success: true });

    const classifications = globalServiceRegistry.get(S1_CLASSIFICATION_REPOSITORY_TOKEN);

    // 8 — the as-filed header SIC is the ONLY signal: a completed de-SPAC that
    // renamed and recoded, so nothing else in the screen remembers it. This is
    // the row the `filedSicMatch` predicate exists for.
    await entities.put(entity(8, "Joby Aviation, Inc.", 3721));
    await filings.put(filing(8, "S-1", "2020-08-01", 8));
    await classifications.put(classification(8, 8, 6770));

    // 9 — a parsed registration whose header carried NO SIC. `filed_sic_6770`
    // must stay null ("not asked yet"), never false: the LEFT JOIN's non-match
    // and the `WHERE sic IS NOT NULL` filter both have to hold for that.
    await entities.put(entity(9, "Gamma Acquisition Corp", 6770));
    await classifications.put(classification(9, 9, null));

    // 10 — several parsed registrations, one of them 6770. The aggregate has
    // to see the whole group, not whichever row it meets first.
    await entities.put(entity(10, "Delta Acquisition Corp", 6770));
    await classifications.put(classification(10, 100, 6199));
    await classifications.put(classification(10, 101, 6770));
    await classifications.put(classification(10, 102, null));

    // 11 — weak-class name whose parsed registration is not a SPAC. The
    // accession matches the filing so latest-by-filing-date is exerciseable,
    // not just the created_at fallback.
    await entities.put(entity(11, "Associates First Capital Corp", 6141));
    await filings.put(filing(11, "S-1", "1996-02-09", 11));
    await classifications.put({
      ...classification(11, 11, 6141),
      accession_number: `0000000000-00-${String(11).padStart(6, "0")}`,
      is_spac: false,
    });
  }

  it("agrees with the repository twin on a full scan", async () => {
    await seed();

    const sql = byCik(await scanSpacCandidates({}));
    const twin = byCik(await scanRepository({}));

    expect(sql).toEqual(twin);
  });

  it("agrees with the repository twin on an incremental --since scan", async () => {
    await seed();

    const sql = byCik(await scanSpacCandidates({ since: "2025-01-01" }));
    const twin = byCik(await scanRepository({ since: "2025-01-01" }));

    expect(sql).toEqual(twin);
    // CIK 7 is the only seeded CIK with a `processed_submissions` row, and its
    // watermark predates the cutoff, so `--since` must drop it while the full
    // scan keeps it.
    expect(sql.map((f) => f.cik)).not.toContain(7);
    expect(byCik(await scanSpacCandidates({})).map((f) => f.cik)).toContain(7);
  });

  it("resolves each fragment correctly, independently of the twin", async () => {
    // Spot assertions written against the fixtures rather than against the
    // other implementation, so a bug SHARED by both still fails here.
    await seed();
    const facts = byCik(await scanSpacCandidates({}));
    const at = (cik: number): SpacCandidateFacts => {
      const found = facts.find((f) => f.cik === cik);
      expect(found, `expected a candidate row for CIK ${cik}`).toBeDefined();
      return found!;
    };

    expect(at(1)).toMatchObject({
      name: "Alpha Acquisition Corp",
      current_sic: 6770,
      first_reg_form: "S-1",
      first_reg_date: "2021-01-05",
    });
    expect(at(2)).toMatchObject({
      renamed_from: "Chardan Healthcare Acquisition 2 Corp",
      spac_name_ended: "2021-09-02",
      first_reg_form: null,
    });
    // The open current row must not win max(valid_to) and blank the field.
    expect(at(3).spac_name_ended).toBe("2021-01-15");
    expect(at(6)).toMatchObject({ first_reg_form: "DRS", current_sic: null });

    expect(facts.map((f) => f.cik)).not.toContain(4);
    expect(facts.map((f) => f.cik)).not.toContain(5);

    // The as-filed header is the only signal that survives a completed de-SPAC.
    expect(at(8)).toMatchObject({ current_sic: 3721, filed_sic_6770: true });
    // Parsed, but the header carried no SIC — "not asked" is not "no".
    expect(at(9).filed_sic_6770).toBeNull();
    // One 6770 among several parsed registrations still answers true.
    expect(at(10).filed_sic_6770).toBe(true);
    // Nothing parsed at all is also null.
    expect(at(1).filed_sic_6770).toBeNull();
    expect(at(1).classified_as_spac).toBeNull();
    expect(at(8).classified_as_spac).toBe(true);
    expect(at(9).classified_as_spac).toBe(false);
    expect(at(10).classified_as_spac).toBe(false);
  });

  it("reads s1_classification once, through the covering index", async () => {
    await seed();
    const { sql, params } = buildScanSql(
      {},
      (id) => `\`${id}\``,
      () => "?"
    );
    const plan = getDb()
      .prepare<(string | number)[], { id: number; parent: number; detail: string }>(
        `EXPLAIN QUERY PLAN ${sql}`
      )
      .all(...params);

    // Exactly one read of the table for the whole scan. The two correlated
    // fragments this replaced (a SELECT-list scalar subquery and a WHERE
    // EXISTS) each re-read `s1_classification` per candidate entity, and would
    // show up here as two rows — including for a version that adds the index
    // but keeps them correlated, which is why the count is the assertion and
    // the index is only half of it. SQLite names the scan after the alias
    // (`cls`) and the index (`s1_classification_…`), not the table.
    const reads = plan.filter((r) => /\bs1_classification_/.test(r.detail));
    expect(reads.map((r) => r.detail)).toHaveLength(1);
    expect(reads[0]!.detail).toMatch(/COVERING INDEX/);

    // ...and it is materialized once rather than re-evaluated per outer row,
    // which is what a `CORRELATED ... SUBQUERY` parent would mean.
    const parent = plan.find((r) => r.id === reads[0]!.parent);
    expect(parent?.detail).toMatch(/^MATERIALIZE/);
  });

  it("grades the scanned facts into the expected tiers", async () => {
    await seed();
    const graded = new Map(
      byCik(await scanSpacCandidates({})).map((f) => [f.cik, classifySpacCandidate(f, AT)])
    );

    expect(graded.get(1)).toMatchObject({ confidence: "high" });
    // Still blank-check-named today despite the earlier closed interval.
    expect(graded.get(3)).toMatchObject({ confidence: "high", reg_while_spac_named: true });
    // Weak-class name with a registration and nothing else.
    expect(graded.get(6)).toMatchObject({ confidence: "medium" });
    // Latest registration classified is_spac=false — off the process worklist.
    expect(graded.get(11)).toMatchObject({ confidence: "low" });
  });
});
