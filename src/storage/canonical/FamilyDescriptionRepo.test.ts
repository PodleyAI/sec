/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { FamilyDescriptionRepo } from "./FamilyDescriptionRepo";

describe("FamilyDescriptionRepo", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("round-trips a description per (kind, name) and overwrites in place", async () => {
    const repo = new FamilyDescriptionRepo();
    await repo.setDescription("sponsor-family", "pershing square sponsor", "Bill Ackman's SPAC vehicle.");
    await repo.setDescription("underwriter-family", "goldman sachs", "Bulge-bracket bank.");

    expect(await repo.getDescription("sponsor-family", "pershing square sponsor")).toBe(
      "Bill Ackman's SPAC vehicle."
    );
    expect(await repo.getDescription("underwriter-family", "goldman sachs")).toBe(
      "Bulge-bracket bank."
    );
    // Same name under a different kind is a distinct row.
    expect(await repo.getDescription("underwriter-family", "pershing square sponsor")).toBeNull();

    await repo.setDescription("sponsor-family", "pershing square sponsor", "Updated.");
    expect(await repo.getDescription("sponsor-family", "pershing square sponsor")).toBe("Updated.");

    const list = await repo.listByKind("sponsor-family");
    expect(list).toHaveLength(1);
  });

  it("returns null for an unknown family and removes on request", async () => {
    const repo = new FamilyDescriptionRepo();
    expect(await repo.getDescription("sponsor-family", "nobody")).toBeNull();
    await repo.setDescription("sponsor-family", "acme sponsor", "x");
    await repo.remove("sponsor-family", "acme sponsor");
    expect(await repo.getDescription("sponsor-family", "acme sponsor")).toBeNull();
  });
});
