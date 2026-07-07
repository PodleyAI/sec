/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "workglow";

/**
 * Controlled vocabulary for a SPAC's business-sector `focus`. The extractor is
 * instructed to choose only from this list so the field stays a clean,
 * queryable facet in the embarc UI (comma-separated tags) rather than free
 * prose. Kept as an exported const so tests and the prompt share one source.
 */
export const FOCUS_VOCABULARY = [
  "Agriculture",
  "Artificial Intelligence",
  "Asset Management",
  "Automotive",
  "Autonomous Vehicles",
  "Aviation",
  "Beauty",
  "Biopharmaceuticals",
  "Blockchain",
  "Business Services",
  "Cannabis",
  "Communications",
  "Compliance",
  "Construction",
  "Consumer",
  "Cryptocurrency",
  "Cybersecurity",
  "Data & Analytics",
  "Defense",
  "Delivery Services",
  "Distressed/Opportunistic",
  "E-commerce",
  "Education",
  "Electric Vehicles",
  "Energy",
  "Energy Services",
  "Entertainment",
  "Fashion",
  "FinTech",
  "Financial Services",
  "Fitness",
  "Food & Beverage",
  "Gaming",
  "Governance",
  "Healthcare",
  "Homebuilding",
  "Hospitality",
  "IT Services",
  "Industrial",
  "Industrial Services",
  "Infrastructure",
  "Insurance",
  "Internet of Things",
  "Legal Services",
  "Leisure",
  "Logistics",
  "Manufacturing",
  "Maritime Shipping",
  "Marketing",
  "Materials",
  "Media",
  "Metaverse",
  "Mobility",
  "Music",
  "Natural Resources",
  "Oil & Gas",
  "Payment Platforms",
  "PropTech",
  "Real Estate",
  "Renewable Energy",
  "Retail",
  "Robotics",
  "Security",
  "Senior Care",
  "Software",
  "Specialty Chemicals",
  "Sports",
  "Technology",
  "Telecommunications",
  "Transportation",
  "Travel",
  "Utilities",
  "Water",
  "Wellness",
] as const;

const CONFIDENCE = { type: "number", minimum: 0, maximum: 1 } as const;

/**
 * Single-object profile of a SPAC's blank-check business intent, drawn from the
 * prospectus summary / proposed-business prose. `focus` items are constrained to
 * {@link FOCUS_VOCABULARY}; `focus_location` is free geographic prose (e.g.
 * "Latin America", "North America"). All narrative fields are nullable — a
 * generalist SPAC with no stated sector focus yields empty arrays / null text.
 */
export const SpacProfileOutputSchema = {
  type: "object",
  properties: {
    focus: {
      type: "array",
      items: { type: "string", enum: [...FOCUS_VOCABULARY] },
    },
    focus_location: {
      type: "array",
      items: { type: "string" },
    },
    description: { type: ["string", "null"] },
    team: { type: ["string", "null"] },
    url_spac: { type: ["string", "null"] },
    confidence: CONFIDENCE,
    source_span: { type: "string" },
    // Required: the model must copy the untrusted-fence nonce verbatim into
    // this field. sectionExtractors.ts compares it against the nonce
    // generated for this call and throws NonceMismatchError on any
    // deviation, before any other field is trusted.
    nonce_seen: { type: "string" },
  },
  required: ["focus", "focus_location", "confidence", "source_span", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface SpacProfileRow {
  focus: string[];
  focus_location: string[];
  description: string | null;
  team: string | null;
  url_spac: string | null;
  confidence: number;
  source_span: string;
}
