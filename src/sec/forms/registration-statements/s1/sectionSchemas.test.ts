/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import {
  ManagementOutputSchema,
  BeneficialOwnershipOutputSchema,
  RelatedPartyOutputSchema,
} from "./sectionSchemas";

describe("section output schemas", () => {
  it("management schema requires a people array", () => {
    expect(ManagementOutputSchema.properties.people.type).toBe("array");
    expect(ManagementOutputSchema.required).toContain("people");
  });
  it("ownership schema exposes owners with figures", () => {
    const item = BeneficialOwnershipOutputSchema.properties.owners.items.properties;
    // Figures are nullable to tolerate '*'/'—'/blank cells in the table.
    expect(item.percent_owned.type).toEqual(["number", "null"]);
    expect(item.shares_owned.type).toEqual(["number", "null"]);
    expect(item.is_selling_stockholder.type).toBe("boolean");
  });
  it("related-party schema exposes parties with transactions", () => {
    const party = RelatedPartyOutputSchema.properties.parties.items.properties;
    expect(party.transactions.type).toBe("array");
  });
});
