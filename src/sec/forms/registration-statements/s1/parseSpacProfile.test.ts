/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { hasProfileIdentification, parseSpacProfile } from "./parseSpacProfile";

const SECTORS =
  "Although we may pursue targets in any industry, we intend to initially focus our search on identifying a prospective target business in financial services, technology, software, data, analytics, asset management.";

const GAMING =
  "While we may pursue an acquisition opportunity in any business, industry, sector or geographical location, we intend to focus on industries that align with the background of our sponsor and management. These industries include the gaming and gaming technology, branded consumer, lodging and entertainment, and Internet commerce sectors, which we refer to as our targeted sectors.";

const ASIA =
  "While we may pursue an initial business combination in any industry or geographic region, we intend to focus our search on businesses throughout Asia. However, we will not consummate our initial business combination with an entity or business with China operations consolidated through a variable interest entity.";

const MATERIALS =
  "We may pursue an initial business combination in any industry or geographic location. However, we intend to focus on identifying and acquiring a company involved in the global material supply chain, including companies engaged in the exploration of minerals and materials. While we intend to maintain a global mandate, we currently expect to give preference and consideration to assets located in high-quality, stable material supply chain jurisdictions, including, without limitation, the United States, Canada, Australia, the United Kingdom, Latin America.";

const GENERALIST =
  "We intend to focus our efforts on identifying and completing our initial business combination with a company that aligns with our team’s experiences, expertise and network of relationships. Our business strategy is expected to be focused on potential acquisition targets that exhibit compelling long-term growth potential.";

const BIO =
  "Mr. Kumar was a Principal at Motive Partners with a particular focus on financial services and technology companies.";

describe("parseSpacProfile", () => {
  it("returns null on empty or non-identifying prose", () => {
    expect(parseSpacProfile("")).toBeNull();
    expect(parseSpacProfile(GENERALIST)).toBeNull();
    expect(parseSpacProfile(BIO)).toBeNull();
    expect(hasProfileIdentification(GENERALIST)).toBe(false);
  });

  it("reads cookie-cutter sector lists", () => {
    const row = parseSpacProfile(SECTORS);
    expect(row?.focus).toEqual([
      "Financial Services",
      "Technology",
      "Software",
      "Data & Analytics",
      "Asset Management",
    ]);
    expect(row?.focus_location).toEqual([]);
    expect(row?.source).toBe("deterministic");
    expect(row?.description).toBeNull();
  });

  it("maps lodging and internet commerce aliases", () => {
    expect(parseSpacProfile(GAMING)?.focus).toEqual([
      "Gaming",
      "Consumer",
      "Hospitality",
      "Entertainment",
      "E-commerce",
    ]);
  });

  it("reads geography from the identifying window only", () => {
    const row = parseSpacProfile(ASIA);
    expect(row?.focus).toEqual([]);
    expect(row?.focus_location).toEqual(["Asia"]);
  });

  it("reads materials plus listed jurisdictions", () => {
    const row = parseSpacProfile(MATERIALS);
    expect(row?.focus).toContain("Materials");
    expect(row?.focus_location).toEqual([
      "United States",
      "Canada",
      "Australia",
      "United Kingdom",
      "Latin America",
    ]);
  });
});
