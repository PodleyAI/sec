/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { EVAL_EXTRACTORS } from "./fixtures";

/** Every property name anywhere in a JSON Schema, however deeply nested. */
function schemaPropertyNames(node: unknown, seen = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return seen;
  if (Array.isArray(node)) {
    for (const child of node) schemaPropertyNames(child, seen);
    return seen;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "properties" && value && typeof value === "object") {
      for (const prop of Object.keys(value as Record<string, unknown>)) seen.add(prop);
    }
    schemaPropertyNames(value, seen);
  }
  return seen;
}

/**
 * A field naming the KIND of entity a row describes. Its presence means the
 * extractor emits organizations as well as people, so nothing in that schema is
 * a person name by construction.
 */
const ENTITY_KIND_DISCRIMINATORS = ["owner_kind", "entity_kind"];

describe("EVAL_EXTRACTORS personNameFields", () => {
  it("is declared only on extractors whose rows are person-only", () => {
    // `matchKey` collapses any value in one of these fields to the production
    // person hash, and that hash is lossy on entity names in exactly the way
    // that matters: it reads a legal-form suffix as a credential and drops it,
    // so "WAVE Equity Fund, L.P." and "WAVE Equity Fund, LLC" both become
    // `wave-equity-fund` and de-duplicate into one row. An extractor that can
    // emit an organization therefore must not list any field here.
    const offenders: string[] = [];
    for (const [name, spec] of Object.entries(EVAL_EXTRACTORS)) {
      if (!spec.personNameFields?.length) continue;
      const props = schemaPropertyNames(spec.schema());
      const discriminator = ENTITY_KIND_DISCRIMINATORS.find((d) => props.has(d));
      if (discriminator) {
        offenders.push(
          `${name} declares personNameFields ${JSON.stringify(spec.personNameFields)} but its ` +
            `schema carries "${discriminator}" — its rows are not person-only`
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names fields that exist in the extractor's own schema", () => {
    // A typo'd field name is silently inert: `matchKey` only special-cases a
    // field it is actually handed, so the extractor would score under plain
    // normalization with nothing saying the flag did nothing.
    for (const [name, spec] of Object.entries(EVAL_EXTRACTORS)) {
      if (!spec.personNameFields?.length) continue;
      const props = schemaPropertyNames(spec.schema());
      for (const field of spec.personNameFields) {
        expect(props.has(field), `${name}: personNameFields names unknown field "${field}"`).toBe(
          true
        );
      }
    }
  });

  it("covers the person-only extractors it is meant to help", () => {
    // The guards above are satisfied by declaring nothing anywhere, so pin the
    // two extractors that genuinely need credential-insensitive alignment.
    expect(EVAL_EXTRACTORS["management"].personNameFields).toEqual(["full_name"]);
    expect(EVAL_EXTRACTORS["executive-compensation"].personNameFields).toEqual(["person_name"]);
    expect(EVAL_EXTRACTORS["beneficial-ownership"].personNameFields).toBeUndefined();
  });

  it("routes a mixed-entity extractor through its own discriminator", () => {
    // The other half of the rule: a mixed extractor must not be left on plain
    // normalization either, which costs it alignment the codebase can already
    // do. It names the field under `entityNameFields` instead.
    const ownership = EVAL_EXTRACTORS["beneficial-ownership"];
    expect(ownership.entityNameFields).toEqual(["name"]);
    expect(ownership.entityKindField).toBe("owner_kind");
  });

  it("names an entityKindField that exists, whenever entityNameFields is used", () => {
    // Without the discriminator the mixed fields silently fall back to plain
    // normalization — the flag would read as configured and do nothing.
    for (const [name, spec] of Object.entries(EVAL_EXTRACTORS)) {
      if (!spec.entityNameFields?.length) continue;
      const props = schemaPropertyNames(spec.schema());
      expect(spec.entityKindField, `${name}: entityNameFields without entityKindField`).toBeTypeOf(
        "string"
      );
      expect(
        props.has(spec.entityKindField!),
        `${name}: entityKindField "${spec.entityKindField}" is not in the schema`
      ).toBe(true);
      for (const field of spec.entityNameFields) {
        expect(props.has(field), `${name}: entityNameFields names unknown field "${field}"`).toBe(
          true
        );
      }
    }
  });
});
