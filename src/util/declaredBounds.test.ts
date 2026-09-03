/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { FilingSchema } from "../storage/filing/FilingSchema";
import { assertWithinDeclaredBounds, DeclaredBoundsError } from "./declaredBounds";
import { TypeNullable } from "./TypeBoxUtil";

const Schema = Type.Object({
  id: Type.String({ maxLength: 8 }),
  note: TypeNullable(Type.String({ maxLength: 16 })),
  freeform: Type.String(),
  count: Type.Number(),
});

describe("assertWithinDeclaredBounds", () => {
  it("accepts rows within every declared width", () => {
    expect(() =>
      assertWithinDeclaredBounds(
        [{ id: "abc", note: "short", freeform: "x".repeat(5000), count: 1 }],
        Schema,
        "row"
      )
    ).not.toThrow();
  });

  it("sees through the nullable wrapper to the inner maxLength", () => {
    expect(() =>
      assertWithinDeclaredBounds([{ id: "abc", note: "x".repeat(17) }], Schema, "row")
    ).toThrow(DeclaredBoundsError);
  });

  it("ignores nulls and unbounded string columns", () => {
    expect(() =>
      assertWithinDeclaredBounds(
        [{ id: "abc", note: null, freeform: "y".repeat(99_999) }],
        Schema,
        "row"
      )
    ).not.toThrow();
  });

  it("names the offending row index and column", () => {
    expect(() =>
      assertWithinDeclaredBounds([{ id: "ok" }, { id: "waaaaaaaaay too long" }], Schema, "widget")
    ).toThrow(/widget 1: id is 20 chars, over the declared maximum of 8/);
  });

  it("rejects an over-long value against a real declared schema", () => {
    // Against a schema the repo actually ships rather than the local fixture:
    // the guard has to read `maxLength` off a TypeBox schema written for
    // storage, not only off one written for this test.
    expect(() =>
      assertWithinDeclaredBounds([{ form: "x".repeat(33) }], FilingSchema, "filing")
    ).toThrow(DeclaredBoundsError);
  });

  it("accepts an unbounded column on that same schema", () => {
    expect(() =>
      assertWithinDeclaredBounds([{ file_number: "1".repeat(500) }], FilingSchema, "filing")
    ).not.toThrow();
  });
});
