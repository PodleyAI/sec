/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { Type } from "typebox";
import Value from "typebox/value";
import { TypeAccessionNumber } from "./accessionNumber";

const Wrapper = Type.Object({ accessionNumber: TypeAccessionNumber() });

describe("TypeAccessionNumber", () => {
  it("accepts a well-formed 20-character accession", () => {
    expect(Value.Check(Wrapper, { accessionNumber: "0001193125-21-066104" })).toBe(true);
  });

  it("rejects a 22-character (too-long) accession at the input boundary", () => {
    expect(Value.Check(Wrapper, { accessionNumber: "0001193125-21-066104XX" })).toBe(false);
  });

  it("rejects a 21-character accession with a trailing extra digit", () => {
    expect(Value.Check(Wrapper, { accessionNumber: "0001193125-21-0661040" })).toBe(false);
  });

  it("rejects an accession missing one of the hyphens", () => {
    expect(Value.Check(Wrapper, { accessionNumber: "000119312521066104XX" })).toBe(false);
  });

  it("rejects an accession with letters in the digit segments", () => {
    expect(Value.Check(Wrapper, { accessionNumber: "AAAA193125-21-066104" })).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(Value.Check(Wrapper, { accessionNumber: "" })).toBe(false);
  });
});
