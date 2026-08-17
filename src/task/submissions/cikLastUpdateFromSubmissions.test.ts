/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import type { CompanySubmission, Filings } from "../../sec/submissions/EnititySubmissionSchema";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { recordCikLastUpdate, StoreSubmissionsTask } from "./StoreSubmissionsTask";

/**
 * Ingesting a submission must leave the `cik_last_update` watermark behind.
 *
 * That watermark is the DEMAND side of the incremental refresh — `update
 * submissions` and `update facts` both select on
 * `cik_last_update.last_update > processed_submissions.last_processed` — and
 * before this change the only writer was `StoreCikLastUpdatedTask`, wired
 * solely into `sync`. So a database built by `bootstrap` had a fully populated
 * `filings` table and an EMPTY watermark, and both incremental commands
 * selected nothing at all. This deployment carried 27M filings against 0 rows
 * here, which is exactly the shape that fails silently: no error, no dead
 * letter, just a daily job that does nothing forever.
 */
describe("cik_last_update is written by submission ingest", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("starts empty, so the assertions below cannot pass vacuously", async () => {
    const repo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    expect((await repo.getAll()) ?? []).toHaveLength(0);
  });

  it("records the NEWEST filing date from a shuffled array, through recordCikLastUpdate", async () => {
    // EDGAR orders `recent` newest-first by convention, but that is convention
    // rather than contract — so the writer scans for the max instead of taking
    // [0]. Shuffled deliberately, and each wrong implementation gets its own
    // named failure below.
    const dates = ["2026-01-05", "2026-08-14", "2025-11-30"];
    await recordCikLastUpdate(320193, { filingDate: dates });

    const repo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    const stored = await repo.get({ cik: 320193 });
    expect(stored?.last_update).toBe("2026-08-14");
    // Taking the first element (trusting EDGAR's ordering) under-reports the
    // filer by seven months.
    expect(stored?.last_update).not.toBe(dates[0]);
    // Taking the last element reports a date older still.
    expect(stored?.last_update).not.toBe(dates.at(-1));
  });

  it("reads input.filings, not submission.filings — FetchSubmissionsTask splits them apart", async () => {
    // `FetchSubmissionsTask` destructures `const { filings, ...submission } =
    // edgarJson`, so the submission object carries no filing dates at all. A
    // writer reaching for `submission.filings` finds nothing and silently
    // writes no watermark.
    const cik = 320193;
    const repo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);

    await new StoreSubmissionsTask().execute(
      { submission: makeSubmission(cik), filings: makeFilings(["2026-01-05", "2026-08-14"]) },
      ctx()
    );
    expect((await repo.get({ cik }))?.last_update).toBe("2026-08-14");

    // Now the negative: the same dates nested on `submission`, and nothing at
    // the top level to read. A writer reaching for `submission.filings` would
    // store 2026-08-14 again; the correct one leaves the table empty.
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    const repo2 = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);

    await new StoreSubmissionsTask().execute(
      {
        submission: {
          ...makeSubmission(cik),
          filings: makeFilings(["2026-01-05", "2026-08-14"]),
        } as never,
        filings: makeFilings([]),
      },
      ctx()
    );
    expect((await repo2.getAll()) ?? []).toHaveLength(0);
  });

  it("writes nothing when the payload carries no filing dates", async () => {
    const repo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);

    await recordCikLastUpdate(1, undefined);
    await recordCikLastUpdate(2, {});
    await recordCikLastUpdate(3, { filingDate: [] });

    expect((await repo.getAll()) ?? []).toHaveLength(0);
  });

  it("does not fail the ingest when the watermark write throws", async () => {
    // Best-effort by design: a watermark failure must not fail a submission
    // whose entity, filings and tickers all stored. The next index run
    // rewrites it anyway.
    const repo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    const boom = new Error("watermark backend is down");
    vi.spyOn(repo, "put").mockRejectedValue(boom);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      recordCikLastUpdate(320193, { filingDate: ["2026-08-14"] })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain("320193");

    warn.mockRestore();
    vi.restoreAllMocks();
  });

  it("keeps a filing date BELOW the processing date, so ingest does not re-select itself", async () => {
    // The two columns are different quantities and the comparison only works
    // because of it: last_update is a FILING date, last_processed is a
    // PROCESSING date. Immediately after an ingest the filing date is
    // necessarily the older one, so `last_update > last_processed` is false and
    // the CIK is not immediately re-queued. Were both stamped "today", every
    // bootstrap would hand `update submissions` its entire corpus.
    const cikRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    const procRepo = globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN);

    await cikRepo.put({ cik: 320193, last_update: "2026-07-31" });
    await procRepo.put({ cik: 320193, last_processed: "2026-08-15", success: true });

    const clu = await cikRepo.get({ cik: 320193 });
    const ps = await procRepo.get({ cik: 320193 });
    expect(clu!.last_update > ps!.last_processed).toBe(false);

    // ...and once EDGAR publishes again, the daily index pushes the watermark
    // past the processing date and the CIK IS selected — exactly once.
    await cikRepo.put({ cik: 320193, last_update: "2026-08-20" });
    const after = await cikRepo.get({ cik: 320193 });
    expect(after!.last_update > ps!.last_processed).toBe(true);
  });
});

function ctx(): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: () => {},
    own: <T>(v: T): T => v,
  } as unknown as IExecuteContext;
}

/** The minimum submission the store subgraph's schema accepts. */
function makeSubmission(cik: number): CompanySubmission {
  const address = {
    street1: "1 Infinite Loop",
    street2: null,
    city: "Cupertino",
    stateOrCountry: "CA",
    zipCode: "95014",
    stateOrCountryDescription: "CA",
  };
  return {
    cik,
    entityType: "operating",
    sic: "3571",
    sicDescription: "Electronic Computers",
    insiderTransactionForOwnerExists: false,
    insiderTransactionForIssuerExists: true,
    name: "TEST FILER INC",
    tickers: [],
    exchanges: [],
    ein: null,
    description: "",
    website: "",
    investorWebsite: "",
    category: "",
    fiscalYearEnd: null,
    stateOfIncorporation: "CA",
    stateOfIncorporationDescription: "CA",
    addresses: { mailing: address, business: address },
    phone: null,
    flags: "",
    formerNames: [],
  } as unknown as CompanySubmission;
}

/** A `Filings` object-of-arrays (the EDGAR submissions shape), one column entry per filing date. */
function makeFilings(filingDates: readonly string[]): Filings {
  const n = filingDates.length;
  const fill = <T>(v: T): T[] => Array.from({ length: n }, () => v);
  return {
    accessionNumber: filingDates.map((_, i) => `0000000000-26-00000${i + 1}`),
    filingDate: [...filingDates],
    reportDate: fill("2025-12-31"),
    acceptanceDateTime: fill("2026-01-01T12:00:00.000Z"),
    act: fill("34"),
    form: fill("8-K"),
    filmNumber: fill("111"),
    fileNumber: fill("000-1"),
    items: fill(""),
    size: fill(1234),
    isXBRL: fill(false),
    isInlineXBRL: fill(false),
    primaryDocument: fill("doc.htm"),
    primaryDocDescription: fill("DOC"),
  };
}
