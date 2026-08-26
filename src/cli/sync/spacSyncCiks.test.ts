/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { S1_CLASSIFICATION_REPOSITORY_TOKEN } from "../../storage/classification/S1ClassificationSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import {
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  type SpacCandidate,
} from "../../storage/spac/SpacCandidateSchema";
import { SPAC_REPOSITORY_TOKEN, type Spac } from "../../storage/spac/SpacSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import {
  dayBeforeUtc,
  filterSpacCiksByHistory,
  listKnownSpacCiks,
  listSpacProcessCiks,
  parseSpacProcessOnly,
  shardCiks,
  spacUpdatesFiledOnOrAfter,
} from "./spacSyncCiks";

function minimalSpac(cik: number): Spac {
  return {
    cik,
    current_cik: null,
    status: "registered",
    spac_name: null,
    target_name: null,
    surviving_name: null,
    surviving_name_source: null,
    current_name: null,
    spac_sic: null,
    post_merger_sic: null,
    current_sic: null,
    spac_tickers: null,
    post_merger_tickers: null,
    current_tickers: null,
    ipo_proceeds: null,
    trust_amount: null,
    current_trust_amount: null,
    current_trust_as_of: null,
    current_trust_filed: null,
    pipe_amount: null,
    total_redemption_amount: null,
    focus: null,
    focus_location: null,
    description: null,
    target_description: null,
    team: null,
    details: null,
    url_spac: null,
    url_sponsor: null,
    investorpres_url: null,
    investorpres_date: null,
    registration_date: null,
    ipo_date: null,
    unit_split_date: null,
    loi_date: null,
    definitive_agreement_date: null,
    proxy_date: null,
    vote_date: null,
    completed_date: null,
    failed_date: null,
    as_of: null,
    updated_at: "2026-08-17T00:00:00.000Z",
  };
}

async function putClassification(args: {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly is_spac: boolean;
  readonly created_at?: string;
}): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik: args.cik,
    accession_number: args.accession_number,
    filing_date: args.filing_date,
    report_date: null,
    acceptance_date: `${args.filing_date}T12:00:00.000Z`,
    form: "S-1",
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
  await globalServiceRegistry.get(S1_CLASSIFICATION_REPOSITORY_TOKEN).put({
    extractor_id: "S-1",
    accession_number: args.accession_number,
    cik: args.cik,
    sic: args.is_spac ? 6770 : 6141,
    sic_description: null,
    is_spac: args.is_spac,
    classifier_source: "sgml-header",
    created_at: args.created_at ?? "2026-08-17T00:00:00.000Z",
  });
}

function candidateRow(cik: number, confidence: SpacCandidate["confidence"]): SpacCandidate {
  return {
    cik,
    name: `Candidate ${cik}`,
    current_sic: 6770,
    signal_sic_6770: true,
    signal_filed_sic_6770: null,
    signal_name_match: true,
    signal_renamed_from: null,
    first_reg_form: "S-1",
    first_reg_date: "2024-01-15",
    reg_while_spac_named: true,
    confidence,
    identified_at: "2026-08-17T00:00:00.000Z",
  };
}

describe("listSpacProcessCiks", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("unions known spac rows with high and medium candidates, sorted and deduped", async () => {
    const spacRepo = globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
    const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);

    await spacRepo.put(minimalSpac(1));
    await candidateRepo.putBulk([
      candidateRow(1, "high"),
      candidateRow(2, "high"),
      candidateRow(3, "medium"),
      candidateRow(4, "low"),
    ]);

    await expect(listSpacProcessCiks()).resolves.toEqual([1, 2, 3]);
  });

  it("returns high and medium candidates when the spac table is empty", async () => {
    const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);

    await candidateRepo.putBulk([
      candidateRow(2, "high"),
      candidateRow(3, "medium"),
      candidateRow(4, "low"),
    ]);

    await expect(listSpacProcessCiks()).resolves.toEqual([2, 3]);
  });

  it("listKnownSpacCiks is the spac table only", async () => {
    const spacRepo = globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
    const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);

    await spacRepo.put(minimalSpac(1));
    await candidateRepo.putBulk([candidateRow(1, "high"), candidateRow(2, "high")]);

    await expect(listKnownSpacCiks()).resolves.toEqual([1]);
    await expect(listSpacProcessCiks()).resolves.toEqual([1, 2]);
  });

  it("drops a medium candidate whose latest registration classified is_spac=false", async () => {
    const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    await candidateRepo.put(candidateRow(7974, "medium"));
    await putClassification({
      cik: 7974,
      accession_number: "0000950134-96-000313",
      filing_date: "1996-02-09",
      is_spac: false,
    });

    await expect(listSpacProcessCiks()).resolves.toEqual([]);
  });

  it("keeps a known SPAC whose later operating registration classified is_spac=false", async () => {
    const spacRepo = globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
    const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    await spacRepo.put(minimalSpac(1848507));
    await candidateRepo.put(candidateRow(1848507, "medium"));
    await putClassification({
      cik: 1848507,
      accession_number: "0001848507-26-000001",
      filing_date: "2026-01-15",
      is_spac: false,
    });

    await expect(listSpacProcessCiks()).resolves.toEqual([1848507]);
  });

  it("keeps a candidate when a later registration classified is_spac=true", async () => {
    const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    await candidateRepo.put(candidateRow(9001, "medium"));
    await putClassification({
      cik: 9001,
      accession_number: "0000000000-21-000001",
      filing_date: "2021-01-01",
      is_spac: false,
    });
    await putClassification({
      cik: 9001,
      accession_number: "0000000000-21-000002",
      filing_date: "2021-06-01",
      is_spac: true,
    });

    await expect(listSpacProcessCiks()).resolves.toEqual([9001]);
  });

  it("uses the later filing date, not process order, as latest", async () => {
    const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    await candidateRepo.put(candidateRow(9002, "high"));
    await putClassification({
      cik: 9002,
      accession_number: "0000000000-21-000010",
      filing_date: "2021-01-01",
      is_spac: true,
      created_at: "2026-08-20T00:00:00.000Z",
    });
    await putClassification({
      cik: 9002,
      accession_number: "0000000000-21-000011",
      filing_date: "2021-06-01",
      is_spac: false,
      created_at: "2026-08-01T00:00:00.000Z",
    });

    await expect(listSpacProcessCiks()).resolves.toEqual([]);
  });
});

async function recordRun(args: {
  cik: number;
  extractor_id: string;
  success?: boolean;
  outcome?: "success" | "partial" | "failure";
  extractor_version?: string;
}): Promise<void> {
  const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  await repo.recordRun({
    cik: args.cik,
    accession_number: `${String(args.cik).padStart(10, "0")}-26-000001`,
    form: args.extractor_id,
    extractor_id: args.extractor_id,
    extractor_version: args.extractor_version ?? "1.0.0",
    slot_at_run: "current",
    success: args.success ?? true,
    outcome: args.outcome,
    error: null,
  });
}

describe("parseSpacProcessOnly", () => {
  it("accepts never-processed and updates", () => {
    expect(parseSpacProcessOnly("never-processed")).toBe("never-processed");
    expect(parseSpacProcessOnly("updates")).toBe("updates");
  });

  it("rejects other values", () => {
    expect(() => parseSpacProcessOnly("both")).toThrow(/Invalid --only/);
  });
});

describe("filterSpacCiksByHistory", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("returns the input list when only is omitted", async () => {
    await expect(filterSpacCiksByHistory([1, 2], undefined)).resolves.toEqual([1, 2]);
  });

  it("never-processed is CIKs with no successful SPAC extractor run", async () => {
    await recordRun({ cik: 1, extractor_id: "S-1" });
    await recordRun({ cik: 2, extractor_id: "S-1", success: false, outcome: "failure" });
    await recordRun({ cik: 3, extractor_id: "D" });

    await expect(filterSpacCiksByHistory([1, 2, 3, 4], "never-processed")).resolves.toEqual([
      2, 3, 4,
    ]);
  });

  it("updates is CIKs with at least one successful SPAC run, including an older version", async () => {
    await recordRun({ cik: 1, extractor_id: "8-K", extractor_version: "0.9.0" });
    await recordRun({ cik: 2, extractor_id: "S-1", outcome: "partial" });

    await expect(filterSpacCiksByHistory([1, 2, 3], "updates")).resolves.toEqual([1]);
  });
});

describe("shardCiks", () => {
  it("returns the full list when sharding is off", () => {
    expect(shardCiks([1, 2, 3], undefined)).toEqual([1, 2, 3]);
    expect(shardCiks([1, 2, 3], { index: 0, count: 1 })).toEqual([1, 2, 3]);
  });

  it("partitions issuers disjointly and completely so one CIK never splits", () => {
    const ciks = [10, 11, 12, 13, 14];
    const shards = [0, 1, 2].map((index) => shardCiks(ciks, { index, count: 3 }));
    expect(shards.flat().toSorted((a, b) => a - b)).toEqual(ciks);
    expect(new Set(shards.flat()).size).toBe(ciks.length);
    for (const shard of shards) {
      expect(new Set(shard).size).toBe(shard.length);
    }
  });
});

/** A run row with an explicit `ran_at`, which `recordRun` always stamps as now. */
async function putRun(args: {
  cik: number;
  extractor_id: string;
  ran_at: string;
  success?: boolean;
  outcome?: "success" | "partial" | "failure";
}): Promise<void> {
  await globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN).put({
    cik: args.cik,
    accession_number: `${String(args.cik).padStart(10, "0")}-26-000001`,
    form: args.extractor_id,
    extractor_id: args.extractor_id,
    extractor_version: "1.0.0",
    slot_at_run: "current",
    ran_at: args.ran_at,
    success: args.success ?? true,
    outcome: args.outcome ?? "success",
    error: null,
  });
}

describe("spacUpdatesFiledOnOrAfter", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the UTC day before the latest successful SPAC extractor run", async () => {
    expect(dayBeforeUtc("2026-08-20T22:33:50.884Z")).toBe("2026-08-19");
    await recordRun({ cik: 1, extractor_id: "S-1" });
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const row = await repo.findRun(1, "0000000001-26-000001", "S-1", "1.0.0");
    await expect(spacUpdatesFiledOnOrAfter()).resolves.toBe(dayBeforeUtc(row!.ran_at));
  });

  it("asks the storage for the newest rows only, never the whole table", async () => {
    // `SYNC_FORM_DOMAINS.spacs` covers 8-K, S-1 and 424, whose `extractor_runs`
    // rows are corpus-wide: the general `sync forms` sweep writes one per
    // issuer, not just per SPAC. Reading every successful row back to compute
    // one max is a multi-hundred-MB spike before a single issuer is touched,
    // paid again by every `--shard` process, and on Postgres the driver buffers
    // the whole result set before any JS runs. Assert the bound reaches the
    // storage layer rather than asserting this happens to be fast.
    await putRun({ cik: 1, extractor_id: "S-1", ran_at: "2026-08-20T00:00:00.000Z" });
    const storage = globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN);
    const spy = vi.spyOn(storage, "query");

    await spacUpdatesFiledOnOrAfter();

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const [, options] of spy.mock.calls) {
      expect(options?.orderBy).toEqual([{ column: "ran_at", direction: "DESC" }]);
      expect(options?.limit).toBeGreaterThan(0);
    }
  });

  it("takes the newest run across every SPAC extractor", async () => {
    await putRun({ cik: 1, extractor_id: "S-1", ran_at: "2026-01-05T00:00:00.000Z" });
    await putRun({ cik: 2, extractor_id: "8-K", ran_at: "2026-06-15T09:00:00.000Z" });
    await putRun({ cik: 3, extractor_id: "424", ran_at: "2026-03-01T00:00:00.000Z" });

    await expect(spacUpdatesFiledOnOrAfter()).resolves.toBe("2026-06-14");
  });

  it("walks past a newer row that is not a success", async () => {
    // A legacy/partial row can carry `success: true` with `outcome: "partial"`.
    // The bounded read is newest-first, so the post-filter has to keep walking
    // rather than stopping at the first row the storage returns.
    await putRun({
      cik: 1,
      extractor_id: "8-K",
      ran_at: "2026-06-15T00:00:00.000Z",
      outcome: "partial",
    });
    await putRun({ cik: 2, extractor_id: "8-K", ran_at: "2026-05-10T00:00:00.000Z" });

    await expect(spacUpdatesFiledOnOrAfter()).resolves.toBe("2026-05-09");
  });

  it("is undefined when nothing has ever run", async () => {
    await expect(spacUpdatesFiledOnOrAfter()).resolves.toBeUndefined();
  });
});
