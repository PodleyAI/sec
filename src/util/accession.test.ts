/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  accessionFromFileName,
  accessionFromFixtureName,
  accessionWithoutDashes,
} from "./accession";

describe("accessionFromFileName", () => {
  it("strips path and extension from a form.idx fileName column", () => {
    expect(accessionFromFileName("edgar/data/1959708/0001062993-25-001035.txt")).toBe(
      "0001062993-25-001035"
    );
  });

  it("returns the empty string when given an empty input", () => {
    expect(accessionFromFileName("")).toBe("");
  });

  it("returns the bare basename for inputs that aren't .txt", () => {
    expect(accessionFromFileName("foo/bar/baz.idx")).toBe("baz.idx");
  });
});

describe("accessionWithoutDashes", () => {
  it("removes the dashes from a canonical accession", () => {
    expect(accessionWithoutDashes("0001062993-25-001035")).toBe("000106299325001035");
  });

  it("is a no-op for inputs that have no dashes", () => {
    expect(accessionWithoutDashes("000106299325001035")).toBe("000106299325001035");
  });
});

describe("accessionFromFixtureName", () => {
  it("reinserts dashes in 10-2-6 form for a fixture filename", () => {
    expect(accessionFromFixtureName("000123456725000001-primary_doc.xml")).toBe(
      "0001234567-25-000001"
    );
  });

  it("returns the input unchanged when it isn't 18 digits", () => {
    expect(accessionFromFixtureName("not-a-fixture.xml")).toBe("not-a-fixture.xml");
  });
});
