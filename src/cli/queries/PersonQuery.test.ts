import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { globalServiceRegistry } from "workglow";
import { PERSON_REPOSITORY_TOKEN } from "../../storage/person/PersonSchema";
import { queryPersons } from "./PersonQuery";

function makePerson(overrides: Partial<Parameters<typeof repo.put>[0]> = {}) {
  return {
    person_hash_id: "abc123",
    first: "John",
    middle: null,
    last: "Doe",
    suffix: null,
    title: "CEO",
    nick: null,
    dob: null,
    notes: null,
    cik: 1318605,
    crd: null,
    ...overrides,
  };
}

let repo: ReturnType<typeof globalServiceRegistry.get<typeof PERSON_REPOSITORY_TOKEN>>;

describe("queryPersons", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = globalServiceRegistry.get(PERSON_REPOSITORY_TOKEN);
  });

  it("returns empty results for empty DB", async () => {
    const result = await queryPersons({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("filters by CIK", async () => {
    await repo.put(makePerson({ person_hash_id: "h1", cik: 1318605 }));
    await repo.put(makePerson({ person_hash_id: "h2", cik: 320193, first: "Jane", last: "Smith" }));

    const result = await queryPersons({ cik: 1318605 });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].first).toBe("John");
  });

  it("filters by search on first+last name (partial, case-insensitive)", async () => {
    await repo.put(makePerson({ person_hash_id: "h1", first: "John", last: "Doe" }));
    await repo.put(makePerson({ person_hash_id: "h2", first: "Jane", last: "Smith" }));

    const result = await queryPersons({ search: "john" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].first).toBe("John");
  });

  it("filters by role (partial match on title)", async () => {
    await repo.put(makePerson({ person_hash_id: "h1", title: "CEO" }));
    await repo.put(makePerson({ person_hash_id: "h2", title: "General Counsel", first: "Jane" }));

    const result = await queryPersons({ role: "ceo" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].title).toBe("CEO");
  });

  it("respects limit and offset", async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.put(
        makePerson({
          person_hash_id: `h${i}`,
          first: `Person${i}`,
        })
      );
    }

    const result = await queryPersons({ limit: 2, offset: 1 });
    expect(result.rows.length).toBe(2);
    expect(result.total).toBe(5);
  });
});
