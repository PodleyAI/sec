import { beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { queryFilings } from "./FilingQuery";

function makeFiling(overrides: Partial<Parameters<typeof repo.put>[0]> = {}) {
  return {
    cik: 1318605,
    accession_number: "0001-26-001",
    filing_date: "2026-03-01",
    form: "10-K",
    primary_doc: "doc.htm",
    acceptance_date: "2026-03-01T00:00:00",
    report_date: null,
    file_number: null,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
    ...overrides,
  };
}

let repo: ReturnType<typeof globalServiceRegistry.get<typeof FILING_REPOSITORY_TOKEN>>;

describe("queryFilings", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  });

  it("returns empty results for empty DB", async () => {
    const result = await queryFilings({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("filters by CIK", async () => {
    await repo.put(makeFiling({ cik: 1318605, accession_number: "0001-26-001" }));
    await repo.put(makeFiling({ cik: 320193, accession_number: "0001-26-002" }));

    const result = await queryFilings({ cik: 1318605 });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].cik).toBe(1318605);
  });

  it("filters by form type", async () => {
    await repo.put(makeFiling({ accession_number: "0001-26-001", form: "10-K" }));
    await repo.put(makeFiling({ accession_number: "0001-26-002", form: "10-Q" }));

    const result = await queryFilings({ form: "10-K" });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].form).toBe("10-K");
  });

  it("filters by date range (after)", async () => {
    await repo.put(makeFiling({ accession_number: "0001-26-001", filing_date: "2026-01-15" }));
    await repo.put(makeFiling({ accession_number: "0001-26-002", filing_date: "2026-03-15" }));

    const result = await queryFilings({ after: "2026-02-01" });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].filing_date).toBe("2026-03-15");
  });

  it("filters by date range (before)", async () => {
    await repo.put(makeFiling({ accession_number: "0001-26-001", filing_date: "2026-01-15" }));
    await repo.put(makeFiling({ accession_number: "0001-26-002", filing_date: "2026-03-15" }));

    const result = await queryFilings({ before: "2026-02-01" });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].filing_date).toBe("2026-01-15");
  });

  it("filters by search on primary_doc_description", async () => {
    await repo.put(
      makeFiling({
        accession_number: "0001-26-001",
        primary_doc_description: "Annual Report",
      })
    );
    await repo.put(
      makeFiling({
        accession_number: "0001-26-002",
        primary_doc_description: "Quarterly Report",
      })
    );

    const result = await queryFilings({ search: "annual" });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].primary_doc_description).toBe("Annual Report");
  });

  it("combines filters", async () => {
    await repo.put(
      makeFiling({
        cik: 1318605,
        accession_number: "0001-26-001",
        form: "10-K",
        filing_date: "2026-03-01",
      })
    );
    await repo.put(
      makeFiling({
        cik: 1318605,
        accession_number: "0001-26-002",
        form: "10-Q",
        filing_date: "2026-03-15",
      })
    );
    await repo.put(
      makeFiling({
        cik: 320193,
        accession_number: "0001-26-003",
        form: "10-K",
        filing_date: "2026-01-10",
      })
    );

    const result = await queryFilings({
      cik: 1318605,
      form: "10-K",
      after: "2026-02-01",
    });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].accession_number).toBe("0001-26-001");
  });

  it("respects limit and offset", async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.put(
        makeFiling({
          cik: 1318605,
          accession_number: `0001-26-${String(i).padStart(3, "0")}`,
          filing_date: `2026-03-${String(i).padStart(2, "0")}`,
        })
      );
    }

    const result = await queryFilings({ limit: 2, offset: 1 });
    expect(result.rows.length).toBe(2);
    expect(result.total).toBe(5);
  });
});
