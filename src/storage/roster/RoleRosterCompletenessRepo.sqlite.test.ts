/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { RoleRosterCompletenessRepo } from "./RoleRosterCompletenessRepo";
import { ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN } from "./RoleRosterCompletenessSchema";

/** Mirrors `MAX_ACCESSIONS_PER_QUERY` in the repo — kept local so a drift is visible. */
const CHUNK = 900;

const EXTRACTOR_ID = "D";
const ROLE_SCOPE = "form-d:related-person";
const COMPANY_CIK = 1318605;

function decisionFor(accession_number: string, complete: boolean) {
  return {
    accession_number,
    extractor_id: EXTRACTOR_ID,
    role_scope: ROLE_SCOPE,
    company_cik: COMPANY_CIK,
    filing_date: "2024-01-01",
    complete,
  };
}

/**
 * `listForAccessions` feeds a whole-version rebuild, whose accession list is
 * the corpus — far past the bind-parameter bound SQLite renders an `in` list
 * against. These pin the query COUNT as well as the rows, against a real
 * SQLite backend: the in-memory storage cannot show the `in` criterion reaching
 * SQL, and a result-only assertion passes just as well with the chunking
 * removed.
 */
describe("RoleRosterCompletenessRepo.listForAccessions (sqlite)", () => {
  withSqliteDb("role_roster_completeness_sqlite_test", [ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN]);

  it("reads decisions for many accessions in a single query", async () => {
    const repo = new RoleRosterCompletenessRepo();
    await repo.record(decisionFor("ACC-1", true));
    await repo.record(decisionFor("ACC-2", false));

    const storage = globalServiceRegistry.get(ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN);
    const querySpy = vi.spyOn(storage, "query");

    const rows = await repo.listForAccessions(["ACC-1", "ACC-2", "ACC-3", "ACC-1"]);

    expect(
      rows
        .map((r) => [r.accession_number, r.complete] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    ).toEqual([
      ["ACC-1", true],
      ["ACC-2", false],
    ]);
    // An accession nobody ever ran a closure pass for simply has no row, which
    // reads downstream as "not known to be complete".
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it("splits an accession list longer than the bind-parameter bound into chunked queries", async () => {
    // SQLite renders an `in` list as one bind parameter per value, so a list
    // past SQLITE_MAX_VARIABLE_NUMBER has to be split. The installed engine
    // caps at 32766, so only the query count can hold this in place — a result
    // assertion would pass just as well with the chunking removed.
    const storage = globalServiceRegistry.get(ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN);
    const chunks = 3;
    const remainder = 300;
    const total = CHUNK * (chunks - 1) + remainder;
    const accessions = Array.from({ length: total }, (_, i) => `ACC-${i + 1}`);
    await storage.putBulk(accessions.map((accession) => decisionFor(accession, true)));

    const querySpy = vi.spyOn(storage, "query");
    const rows = await new RoleRosterCompletenessRepo().listForAccessions(accessions);

    expect(querySpy).toHaveBeenCalledTimes(chunks);
    // No single query may carry more accessions than the bound, whatever the
    // engine would have tolerated.
    for (const [criteria] of querySpy.mock.calls) {
      const criterion = (criteria as { accession_number: { value: readonly string[] } })
        .accession_number;
      expect(criterion.value.length).toBeLessThanOrEqual(CHUNK);
    }

    expect(rows).toHaveLength(total);
    // One accession from each of the three chunks.
    expect(new Set(rows.map((r) => r.accession_number))).toEqual(new Set(accessions));
  });

  it("returns nothing for an empty accession list without touching the database", async () => {
    const storage = globalServiceRegistry.get(ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN);
    const querySpy = vi.spyOn(storage, "query");

    expect(await new RoleRosterCompletenessRepo().listForAccessions([])).toEqual([]);
    expect(querySpy).not.toHaveBeenCalled();
  });
});
