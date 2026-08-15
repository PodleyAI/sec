/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SEC_STORAGE_REGISTRY } from "../../config/storageRegistry";
import { REKEY_REEXTRACT_EXTRACTOR_IDS } from "./extractorIds";

/**
 * The two re-key scripts are plain SQL, so nothing else checks them: a table
 * renamed in the registry, an extractor id that drifts from
 * {@link REKEY_REEXTRACT_EXTRACTOR_IDS}, or a group added to one variant and
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
 * The company canonical / link / junction group. Still spared by both scripts —
 * but NOT because it is untouched. `normalizeCompanyName` changed in the same
 * release, so `company_observations.normalized_name` (the column
 * `canonical_company` is keyed on) is stale wherever the new rules key a name
 * differently. It is spared because those rows are REBUILDABLE rather than
 * disposable: `normalized_name` derives from the `name` each observation
 * already carries, so `sec resolve --kind company --all --renormalize`
 * recomputes and re-partitions in place. Wiping them instead would cost a full
 * re-extraction and its AI bill for a value one command can recompute — which
 * is why the scripts must PRESCRIBE that command, asserted below.
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
  it.each(VARIANTS)("%s: scopes its gates to REKEY_REEXTRACT_EXTRACTOR_IDS", (_name, sql) => {
    // Two ways to get this wrong, in opposite directions. Too wide (clearing
    // the tables outright) re-runs the AI extractors that observe no person and
    // whose output this script never deleted — 8-K redemption/LOI, merger-proxy
    // — re-paying their model cost for nothing. Too narrow leaves an extractor
    // whose output WAS deleted with no way back: `424` is the live case.
    const lists = scopedExtractorIds(sql);
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect([...list].sort()).toEqual([...REKEY_REEXTRACT_EXTRACTOR_IDS].sort());
    }
  });

  it.each(VARIANTS)("%s: re-extracts 424, whose family links it wipes", (_name, sql) => {
    // `underwriter_link` / `underwriter_family_membership` carry rows written by
    // the priced-424 path, and the family link row IS the attribution — batch
    // `sec resolve` refuses the family kinds, so nothing rebuilds it. Wiping
    // those tables while leaving `424` out of the gates destroys every
    // 424-sourced underwriter attribution permanently.
    const targeted = targetedTables(sql);
    expect(targeted.has("underwriter_link")).toBe(true);
    for (const list of scopedExtractorIds(sql)) {
      expect(list).toContain("424");
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
    // Pinning `search_path` is what makes the Postgres variant safe under a
    // search path that lists another schema first — and sqlite3 rejects the
    // statement, so the portable file cannot carry it. Its usage block therefore
    // names sqlite3 only, and must not invite a psql run against unqualified
    // names.
    expect(statements(PORTABLE)).not.toMatch(/search_path/i);
    expect(PORTABLE).not.toMatch(
      /^--.*\bpsql\s+"\$SEC_PG_URL"\s+-f\s+scripts\/sql\/truncate-identity-tier\.sql/m
    );
  });

  it("pins the Postgres search_path with a statement Postgres accepts", () => {
    // `SET ... TO current_schema()` parses as an identifier followed by `(`, so
    // Postgres rejects it outright. Inside this script's transaction that aborts
    // every following statement and the COMMIT rolls back — the ceremony reports
    // errors and wipes nothing, which no test reading the file as text would
    // notice. `set_config(name, value, is_local)` is the expression-context
    // spelling, and `true` is what makes it LOCAL.
    //
    // The value is allowed to be wrapped (today: `quote_ident(...)`), because
    // `search_path` is a list of IDENTIFIERS and an unquoted element is
    // case-folded — a schema named `Staging` would be written as `Staging`,
    // resolved as `staging`, and the pin would fail open. What is pinned is
    // that `current_schema()` supplies the value and that the whole thing is a
    // `set_config` expression, not a `SET`.
    const body = statements(POSTGRES);
    expect(body).not.toMatch(/SET\s+(LOCAL\s+)?search_path\s+TO\s+current_schema\s*\(/i);
    expect(body).toMatch(
      /SELECT\s+set_config\(\s*'search_path'\s*,\s*[\s\S]*?current_schema\(\)[\s\S]*?,\s*true\s*\)/i
    );
  });

  it("quotes the schema identifier it pins the search_path to", () => {
    // `current_schema()` returns the name verbatim, but `search_path` parses
    // its elements as identifiers and case-folds anything unquoted. On a
    // deployment whose schema is `Staging`, the unquoted form writes `Staging`,
    // Postgres resolves it as `staging`, the pin matches nothing, and every
    // unqualified name below falls back to whatever the surrounding search path
    // finds first — silently, since an unresolvable path element is not an
    // error. That is the exact hazard the pin exists to close.
    expect(statements(POSTGRES)).toMatch(
      /set_config\(\s*'search_path'\s*,\s*quote_ident\(\s*current_schema\(\)\s*\)\s*,\s*true\s*\)/i
    );
  });

  it.each(VARIANTS)("%s: prescribes the company renormalize pass", (_name, sql) => {
    // The company tier is spared from the wipe, but `normalizeCompanyName`
    // changed in the same release, so `company_observations.normalized_name` is
    // stale. `Churchill Capital Corp I` used to normalize to `Churchill
    // Capital` — colliding with the plain name — and now keys distinctly; the
    // release exists to SPLIT those merged canonical identities.
    //
    // An operator who skips `--renormalize` keeps every one of them. Nothing
    // errors: the stale keys still resolve, `version coverage` still reports
    // full coverage, and the two unrelated Reinvent Technology Partners filers
    // stay one canonical company forever. The scripts are the only place that
    // instruction can live, so it has to be in both — which is what this pins.
    //
    // Read the RAW file, not `statements()`: the instruction is prose in a `--`
    // comment, which that helper strips by design.
    expect(sql).toMatch(/sec resolve --kind company --all --renormalize/);
  });

  it.each(VARIANTS)("%s: no longer claims normalizeCompanyName is unchanged", (_name, sql) => {
    // The claim that justified sparing the tier ("`normalizeCompanyName` is
    // unchanged, so `normalized_name` is still valid") was false as of the very
    // merge that shipped these scripts. Sparing the tier is still right — the
    // rows are rebuildable — but on the opposite reasoning, and an operator who
    // reads the old sentence concludes there is nothing left to do.
    expect(sql).not.toMatch(/normalizeCompanyName`? is unchanged/i);
  });
});
