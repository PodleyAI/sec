import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "../../storage/observation/PersonObservationSchema";
import { queryPersons } from "./PersonQuery";

let nextId = 1;

function makeObservation(overrides: Partial<Parameters<typeof repo.put>[0]> = {}) {
  return {
    observation_id: nextId++,
    accession_number: "0001234567-25-000001",
    extractor_id: "D",
    extractor_version: "1.0.0",
    observation_index: 0,
    source_filing_issuer_cik: 1318605,
    cik: null,
    first_name: "John",
    middle_name: null,
    last_name: "Doe",
    suffix: null,
    normalized_first: null,
    normalized_middle: null,
    normalized_last: null,
    normalized_suffix: null,
    titles: ["CEO"],
    relationship: null,
    raw_address_id: null,
    raw_phone_id: null,
    source_context: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

let repo: ReturnType<typeof globalServiceRegistry.get<typeof PERSON_OBSERVATION_REPOSITORY_TOKEN>>;

describe("queryPersons", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    nextId = 1;
    repo = globalServiceRegistry.get(PERSON_OBSERVATION_REPOSITORY_TOKEN);
  });

  it("returns empty results for empty DB", async () => {
    const result = await queryPersons({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("filters by CIK (source_filing_issuer_cik)", async () => {
    await repo.put(makeObservation({ observation_id: 1, source_filing_issuer_cik: 1318605 }));
    await repo.put(
      makeObservation({
        observation_id: 2,
        accession_number: "0001234567-25-000002",
        source_filing_issuer_cik: 320193,
        first_name: "Jane",
        last_name: "Smith",
      })
    );

    const result = await queryPersons({ cik: 1318605 });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].first_name).toBe("John");
  });

  it("filters by search on first+middle+last name (partial, case-insensitive)", async () => {
    await repo.put(makeObservation({ observation_id: 1, first_name: "John", last_name: "Doe" }));
    await repo.put(
      makeObservation({
        observation_id: 2,
        accession_number: "0001234567-25-000002",
        first_name: "Jane",
        last_name: "Smith",
      })
    );

    const result = await queryPersons({ search: "john" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].first_name).toBe("John");
  });

  it("streamed search reports the FULL match count with no totalApprox when drained", async () => {
    // Regression: streamed total was pinned at offset+limit. With 15
    // "Aaron" matches and a limit of 4, total must be 15 (the full match
    // count) and totalApprox must be undefined since the stream drained.
    for (let i = 1; i <= 15; i++) {
      await repo.put(
        makeObservation({
          observation_id: i,
          accession_number: `000123456${i}-25-000001`,
          first_name: "Aaron",
          last_name: `Surname${i}`,
        })
      );
    }
    await repo.put(
      makeObservation({
        observation_id: 999,
        accession_number: "0009999999-25-000001",
        first_name: "Zelda",
        last_name: "Other",
      })
    );

    const result = await queryPersons({ search: "aaron", limit: 4, offset: 0 });
    expect(result.rows.length).toBe(4);
    expect(result.total).toBe(15);
    expect(result.totalApprox).toBeUndefined();
  });

  it("filters by relationship (partial match)", async () => {
    await repo.put(makeObservation({ observation_id: 1, relationship: "Director" }));
    await repo.put(
      makeObservation({
        observation_id: 2,
        accession_number: "0001234567-25-000002",
        relationship: "Officer",
        first_name: "Jane",
      })
    );

    const result = await queryPersons({ relationship: "director" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].relationship).toBe("Director");
  });

  it("respects limit and offset", async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.put(
        makeObservation({
          observation_id: i,
          accession_number: `000123456${i}-25-000001`,
          first_name: `Person${i}`,
        })
      );
    }

    const result = await queryPersons({ limit: 2, offset: 1 });
    expect(result.rows.length).toBe(2);
    expect(result.total).toBe(5);
  });
});
