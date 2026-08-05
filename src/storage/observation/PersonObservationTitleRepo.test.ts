/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import { PersonObservationTitleRepo } from "./PersonObservationTitleRepo";
import {
  PersonObservationTitlePrimaryKeyNames,
  PersonObservationTitleSchema,
  type PersonObservationTitle,
} from "./PersonObservationTitleSchema";

function makeRepo(): PersonObservationTitleRepo {
  return new PersonObservationTitleRepo({
    personObservationTitleRepository: new InMemoryTabularStorage<
      typeof PersonObservationTitleSchema,
      typeof PersonObservationTitlePrimaryKeyNames,
      PersonObservationTitle
    >(PersonObservationTitleSchema, PersonObservationTitlePrimaryKeyNames, [["observation_id"]]),
  });
}

describe("PersonObservationTitleRepo", () => {
  it("stores one row per title, deduped case-insensitively", async () => {
    const repo = makeRepo();
    await repo.replaceForObservation(1, [
      "Director",
      "Chief Executive Officer",
      "  chief executive officer ",
      "",
    ]);
    expect(await repo.listForObservation(1)).toEqual(["Chief Executive Officer", "Director"]);
  });

  it("a reordered replay is a no-op — same rows, no duplicates", async () => {
    const storage = new InMemoryTabularStorage<
      typeof PersonObservationTitleSchema,
      typeof PersonObservationTitlePrimaryKeyNames,
      PersonObservationTitle
    >(PersonObservationTitleSchema, PersonObservationTitlePrimaryKeyNames, [["observation_id"]]);
    const repo = new PersonObservationTitleRepo({ personObservationTitleRepository: storage });
    await repo.replaceForObservation(1, ["Chief Executive Officer", "Director"]);
    await repo.replaceForObservation(1, ["Director", "Chief Executive Officer"]);
    const rows = (await storage.query({ observation_id: 1 })) ?? [];
    expect(rows).toHaveLength(2);
    expect(await repo.listForObservation(1)).toEqual(["Chief Executive Officer", "Director"]);
  });

  it("replaces wholesale so a shorter re-observation leaves no stale rows", async () => {
    const repo = makeRepo();
    await repo.replaceForObservation(1, ["Chief Executive Officer", "Director", "President"]);
    await repo.replaceForObservation(1, ["Director"]);
    expect(await repo.listForObservation(1)).toEqual(["Director"]);
  });

  it("clamps titles to the 256-char column width", async () => {
    const repo = makeRepo();
    await repo.replaceForObservation(1, ["t".repeat(300)]);
    expect((await repo.listForObservation(1))[0]).toBe("t".repeat(256));
  });

  it("scopes rows per observation and deletes per observation", async () => {
    const repo = makeRepo();
    await repo.replaceForObservation(1, ["Director"]);
    await repo.replaceForObservation(2, ["Promoter"]);
    const byId = await repo.listForObservations([1, 2, 3]);
    expect(byId.get(1)).toEqual(["Director"]);
    expect(byId.get(2)).toEqual(["Promoter"]);
    expect(byId.get(3)).toEqual([]);
    await repo.deleteForObservation(1);
    expect(await repo.listForObservation(1)).toEqual([]);
    expect(await repo.listForObservation(2)).toEqual(["Promoter"]);
  });

  it("de-duplicates the requested ids and sorts each list", async () => {
    const repo = makeRepo();
    await repo.replaceForObservation(7, ["President", "Director", "Chief Financial Officer"]);
    const byId = await repo.listForObservations([7, 7, 7]);
    expect(byId.size).toBe(1);
    expect(byId.get(7)).toEqual(["Chief Financial Officer", "Director", "President"]);
  });
});
