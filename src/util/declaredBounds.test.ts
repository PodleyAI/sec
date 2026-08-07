/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { TypeNullable } from "./TypeBoxUtil";
import { DeclaredBoundsError, assertWithinDeclaredBounds } from "./declaredBounds";
import { RelatedPartyTransactionSchema } from "../storage/related-party/RelatedPartyTransactionSchema";

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
      assertWithinDeclaredBounds([{ id: "abc", note: null, freeform: "y".repeat(99_999) }], Schema, "row")
    ).not.toThrow();
  });

  it("names the offending row index and column", () => {
    expect(() =>
      assertWithinDeclaredBounds([{ id: "ok" }, { id: "waaaaaaaaay too long" }], Schema, "widget")
    ).toThrow(/widget 1: id is 20 chars, over the declared maximum of 8/);
  });

  it("rejects the real over-long related-party value before anything is written", () => {
    // `counterparty` is the remaining bounded free-text column on this table
    // (`period` was unbounded after an over-long clause threw mid-persist and
    // left five rows behind on a live filing).
    expect(() =>
      assertWithinDeclaredBounds(
        [{ counterparty: "x".repeat(257) }],
        RelatedPartyTransactionSchema,
        "related-party transaction"
      )
    ).toThrow(DeclaredBoundsError);
  });

  it("no longer bounds `period`, which holds filer prose", () => {
    expect(() =>
      assertWithinDeclaredBounds(
        [{ period: "In connection with an intended initial business combination".repeat(20) }],
        RelatedPartyTransactionSchema,
        "related-party transaction"
      )
    ).not.toThrow();
  });
});
