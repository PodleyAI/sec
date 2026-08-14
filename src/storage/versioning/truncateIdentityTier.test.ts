/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SEC_STORAGE_REGISTRY } from "../../config/storageRegistry";
import { PERSON_OBSERVING_EXTRACTOR_IDS } from "./extractorIds";

/**
 * The two re-key scripts are plain SQL, so nothing else checks them: a table
 * renamed in the registry, an extractor id that drifts from
 * {@link PERSON_OBSERVING_EXTRACTOR_IDS}, or a group added to one variant and
 * not the other all ship silently and are discovered by an operator running a
 * destructive ceremony against a production database.
 *
 * Lives under `src/` rather than beside the scripts because vitest's `include`
 * is `src/**\/*.test.ts` — a test in `scripts/` would never run.
 */
const SQL_DIR = resolve(__dirname, "../../../scripts/sql");
const PORTABLE = readFileSync(resolve(SQL_DIR, "truncate-identity-tier.sql"), "utf-8");
const POSTGRES = readFileSync(resolve(SQL_DIR, "truncate-identity-tier.postgres.sql"), "utf-8");

/** The file with `--` comment lines removed, so prose never reads as SQL. */
function statements(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

/** Every table the script actually touches, from its DELETE and TRUNCATE targets. */
function targetedTables(sql: string): Set<string> {
  const body = statements(sql);
  const tables = new Set<string>();
  for (const m of body.matchAll(/DELETE\s+FROM\s+([a-z_][a-z0-9_]*)/gi)) {
    tables.add(m[1]!.toLowerCase());
  }
  const truncate = body.match(/TRUNCATE\s+TABLE([\s\S]*?)RESTART\s+IDENTITY/i);
  if (truncate) {
    for (const name of truncate[1]!.split(",")) {
      const trimmed = name.trim();
      if (trimmed !== "") tables.add(trimmed.toLowerCase());
    }
  }
  return tables;
}

/** The extractor ids each script scopes its re-extraction gates to. */
function scopedExtractorIds(sql: string): string[][] {
  return [...statements(sql).matchAll(/extractor_id\s+IN\s*\(([^)]*)\)/gi)].map((m) =>
    m[1]!
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter((s) => s !== "")
  );
}

/**
 * The company canonical / link / junction group. Not stale after a person or
 * family normalizer change — `normalizeCompanyName` is unchanged, so
 * `company_observations.normalized_name` (the column `canonical_company` is
 * keyed on) still holds — and there is no rebuild path short of re-extracting
 * every company-observing filing, since `sec resolve --kind company` reads
 * those very observations.
 */
const COMPANY_TIER_TABLES = [
  "canonical_company",
  "canonical_company_alias",
  "canonical_company_address",
  "canonical_company_phone",
  "company_identity_link",
  "company_observations",
];

const VARIANTS: readonly (readonly [string, string])[] = [
  ["portable", PORTABLE],
  ["postgres", POSTGRES],
];

describe("truncate-identity-tier scripts", () => {
  it.each(VARIANTS)("%s: scopes its gates to PERSON_OBSERVING_EXTRACTOR_IDS", (_name, sql) => {
    // Clearing `extractor_runs` / `extraction_dead_letter` wholesale re-runs the
    // AI extractors that observe no person at all (8-K redemption/LOI,
    // merger-proxy), re-paying their model cost for output this script never
    // deleted.
    const lists = scopedExtractorIds(sql);
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect([...list].sort()).toEqual([...PERSON_OBSERVING_EXTRACTOR_IDS].sort());
    }
  });

  it.each(VARIANTS)("%s: leaves the company canonical tier alone", (_name, sql) => {
    const targeted = targetedTables(sql);
    for (const table of COMPANY_TIER_TABLES) {
      expect(targeted.has(table), `${table} must not be wiped`).toBe(false);
    }
  });

  it("names the same table set in both variants", () => {
    // The two files are one ceremony in two dialects. A group added to only one
    // leaves a deployment half-wiped depending on its backend.
    expect([...targetedTables(POSTGRES)].sort()).toEqual([...targetedTables(PORTABLE)].sort());
  });

  it.each(VARIANTS)("%s: names only tables the storage registry creates", (_name, sql) => {
    // A renamed or dropped table makes the script fail mid-ceremony, inside a
    // transaction, on a database an operator is already midway through wiping.
    const known = new Set(SEC_STORAGE_REGISTRY.map((s) => s.table));
    for (const table of targetedTables(sql)) {
      expect(known.has(table), `${table} is not in SEC_STORAGE_REGISTRY`).toBe(true);
    }
  });

  it.each(VARIANTS)("%s: scopes observation_provenance to the person rows", (_name, sql) => {
    // Provenance is keyed by (kind, observation_id) and shared with the company
    // tier, whose observations survive. An unscoped delete destroys company-kind
    // provenance for underwriter/issuer observations that are still here.
    expect(statements(sql)).toMatch(
      /DELETE\s+FROM\s+observation_provenance\s+WHERE\s+kind\s*=\s*'person'/i
    );
  });

  it("keeps the portable variant portable", () => {
    // `SET LOCAL search_path` is what makes the Postgres variant safe under a
    // search path that lists another schema first — and sqlite3 rejects it, so
    // the portable file cannot carry it. Its usage block therefore names sqlite3
    // only, and must not invite a psql run against unqualified names.
    expect(PORTABLE).not.toMatch(/SET\s+LOCAL\s+search_path/i);
    expect(PORTABLE).not.toMatch(/^--.*\bpsql\s+"\$SEC_PG_URL"\s+-f\s+scripts\/sql\/truncate-identity-tier\.sql/m);
    expect(POSTGRES).toMatch(/SET\s+LOCAL\s+search_path\s+TO\s+current_schema\(\)/i);
  });
});
