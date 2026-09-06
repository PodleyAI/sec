/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DB_TYPE } from "../../config/tokens";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { listFactsEligibleCiks } from "./factsEligibleCiks";

const SCHEMA = "sec_prod";

const filing = (cik: number, xbrl: { is_xbrl?: boolean }) => ({
  cik,
  accession_number: `${String(cik).padStart(10, "0")}-26-000001`,
  filing_date: "2026-01-02",
  report_date: null,
  acceptance_date: "2026-01-02T12:00:00.000Z",
  form: "10-K",
  file_number: null,
  film_number: null,
  primary_doc: "primary.htm",
  primary_doc_description: null,
  size: null,
  is_xbrl: xbrl.is_xbrl ?? false,
  is_inline_xbrl: false,
  is_xbrl_numeric: false,
  items: null,
  act: null,
});

const entity = (cik: number, sic: number | null) => ({
  cik,
  name: `Company ${cik}`,
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

/**
 * Records the SQL the Postgres path issues, and answers the two queries it
 * makes, so the statement can be asserted without a live database.
 */
const pg = vi.hoisted(() => {
  const recorded: string[] = [];
  const pool = {
    async query(sql: string) {
      recorded.push(sql);
      if (sql.includes("current_schema()")) return { rows: [{ name: "sec_prod" }] };
      return { rows: [{ cik: 320193 }] };
    },
  };
  return { recorded, pool };
});

vi.mock("../../util/pg", () => ({
  getPgPool: () => pg.pool,
  closePgPool: async () => {},
}));

describe("listFactsEligibleCiks on Postgres", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    pg.recorded.length = 0;
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    // Durable stubs: the raw-SQL path is chosen only when the bound repos could
    // be the same store the pool reaches, and this path never calls them.
    globalServiceRegistry.registerInstance(FILING_REPOSITORY_TOKEN, {
      isDurable: () => true,
    } as never);
    globalServiceRegistry.registerInstance(ENTITY_REPOSITORY_TOKEN, {
      isDurable: () => true,
    } as never);
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("qualifies both relations to the current schema", async () => {
    // An unqualified name resolves through the search_path. With
    // `search_path=sec_prod,public` and an older `public.filings` still around,
    // the eligible set is computed from a table sec does not own — and the
    // facts sweep silently skips or over-fetches whatever that table says.
    await listFactsEligibleCiks();

    const union = pg.recorded.find((sql) => sql.includes("UNION"));
    expect(union).toBeDefined();
    expect(union).toContain(`"${SCHEMA}"."filings"`);
    expect(union).toContain(`"${SCHEMA}"."entities"`);
    expect(union).not.toMatch(/FROM "filings"/);
    expect(union).not.toMatch(/FROM "entities"/);
  });
});

describe("listFactsEligibleCiks on the repository fallback", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("unions the XBRL flags with the CIKs carrying a SIC", async () => {
    const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    await filings.put(filing(100, { is_xbrl: true }));
    await filings.put(filing(200, {}));
    await globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN).put(entity(300, 7372));

    // 200 files, but carries neither signal — a reporting person, which is what
    // this filter exists to keep out of the sweep.
    expect([...(await listFactsEligibleCiks())].sort()).toEqual([100, 300]);
  });
});
