import { beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { CIK_NAME_REPOSITORY_TOKEN } from "../../storage/entity/CikNameSchema";
import { queryCiks } from "./CikQuery";

async function seed(rows: { cik: number; name: string | null }[]): Promise<void> {
  const repo = globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN);
  for (const row of rows) {
    await repo.put(row);
  }
}

describe("queryCiks", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("returns empty array and total 0 for empty DB", async () => {
    const result = await queryCiks({ name: "apple" });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.tableEmpty).toBe(true);
  });

  it("finds a case-insensitive substring match", async () => {
    await seed([
      { cik: 320193, name: "APPLE INC" },
      { cik: 1318605, name: "TESLA, INC." },
    ]);

    const result = await queryCiks({ name: "apple" });
    expect(result.total).toBe(1);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].cik).toBe(320193);
    expect(result.rows[0].name).toBe("APPLE INC");
  });

  it("matches regardless of needle case", async () => {
    await seed([{ cik: 320193, name: "Apple Inc." }]);

    const result = await queryCiks({ name: "APPLE" });
    expect(result.total).toBe(1);
    expect(result.rows[0].cik).toBe(320193);
  });

  it("ranks exact match before prefix before substring", async () => {
    await seed([
      { cik: 1, name: "Pineapple Corp" },
      { cik: 2, name: "Apple Computer Holdings" },
      { cik: 3, name: "Apple" },
    ]);

    const result = await queryCiks({ name: "apple" });
    expect(result.total).toBe(3);
    expect(result.rows.map((r) => r.cik)).toEqual([3, 2, 1]);
  });

  it("breaks rank ties by shorter name then lower CIK", async () => {
    await seed([
      { cik: 10, name: "Apple Electronics Inc" },
      { cik: 5, name: "Apple Motors" },
      { cik: 20, name: "Apple Motors" },
    ]);

    const result = await queryCiks({ name: "apple" });
    expect(result.rows.map((r) => r.cik)).toEqual([5, 20, 10]);
  });

  it("respects --exact and rejects substring hits", async () => {
    await seed([
      { cik: 1, name: "Apple Inc." },
      { cik: 2, name: "Apple" },
      { cik: 3, name: "Pineapple" },
    ]);

    const result = await queryCiks({ name: "apple", exact: true });
    expect(result.total).toBe(1);
    expect(result.rows[0].cik).toBe(2);
  });

  it("exact match is case-insensitive", async () => {
    await seed([{ cik: 320193, name: "Apple Inc." }]);

    const result = await queryCiks({ name: "APPLE INC.", exact: true });
    expect(result.total).toBe(1);
    expect(result.rows[0].cik).toBe(320193);
  });

  it("ignores rows with null names", async () => {
    await seed([
      { cik: 1, name: null },
      { cik: 2, name: "Apple" },
    ]);

    const result = await queryCiks({ name: "apple" });
    expect(result.total).toBe(1);
    expect(result.rows[0].cik).toBe(2);
  });

  it("respects limit and offset while reporting full total", async () => {
    await seed([
      { cik: 1, name: "Apple Alpha" },
      { cik: 2, name: "Apple Beta" },
      { cik: 3, name: "Apple Gamma" },
      { cik: 4, name: "Apple Delta" },
      { cik: 5, name: "Apple Epsilon" },
    ]);

    const result = await queryCiks({ name: "apple", limit: 2, offset: 1 });
    expect(result.total).toBe(5);
    expect(result.rows.length).toBe(2);
  });

  it("returns empty rows when no names match", async () => {
    await seed([
      { cik: 1, name: "Tesla" },
      { cik: 2, name: "Microsoft" },
    ]);

    const result = await queryCiks({ name: "apple" });
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.tableEmpty).toBe(false);
  });
});
