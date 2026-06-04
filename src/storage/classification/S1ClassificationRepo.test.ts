/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { S1ClassificationRepo } from "./S1ClassificationRepo";

describe("S1ClassificationRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("saves and reads a classification row by natural key", async () => {
    const repo = new S1ClassificationRepo();
    await repo.save({
      extractor_id: "S-1",
      accession_number: "0000000000-26-000001",
      cik: 1848507,
      sic: 6770,
      sic_description: "BLANK CHECKS",
      is_spac: true,
      classifier_source: "sgml-header",
      created_at: new Date().toISOString(),
    });
    const got = await repo.get("S-1", "0000000000-26-000001");
    expect(got?.is_spac).toBe(true);
    expect(got?.sic).toBe(6770);
  });
});
