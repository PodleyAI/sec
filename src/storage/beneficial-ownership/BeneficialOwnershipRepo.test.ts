/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { BeneficialOwnershipRepo } from "./BeneficialOwnershipRepo";

describe("BeneficialOwnershipRepo", () => {
  let repo: BeneficialOwnershipRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = new BeneficialOwnershipRepo();
  });

  it("saves, queries by accession, and clears", async () => {
    await repo.save({
      accession_number: "0000000000-26-000001",
      extractor_id: "S-1",
      observation_index: 3,
      owner_kind: "company",
      observation_id: 100,
      security_class: "Common Stock",
      shares_owned: 1_000_000,
      percent_owned: 12.5,
      shares_offered: 200_000,
      shares_after: 800_000,
      percent_after: 9.1,
      is_selling_stockholder: true,
      footnote: "Includes shares held by affiliated funds.",
    });
    const rows = await repo.queryByAccession("0000000000-26-000001");
    expect(rows).toHaveLength(1);
    expect(rows[0].percent_owned).toBe(12.5);

    await repo.clear("0000000000-26-000001");
    expect(await repo.queryByAccession("0000000000-26-000001")).toHaveLength(0);
  });

  it("tolerates null figures (the '*'/'—' cases)", async () => {
    await repo.save({
      accession_number: "a",
      extractor_id: "S-1",
      observation_index: 0,
      owner_kind: "person",
      observation_id: null,
      security_class: null,
      shares_owned: null,
      percent_owned: null,
      shares_offered: null,
      shares_after: null,
      percent_after: null,
      is_selling_stockholder: false,
      footnote: null,
    });
    const rows = await repo.queryByAccession("a");
    expect(rows[0].shares_owned).toBeNull();
  });
});
