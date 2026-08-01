/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertInsideDir, sanitizePrimaryDoc } from "./accessionDocPath";

describe("sanitizePrimaryDoc", () => {
  it("rejects a parent-directory traversal", () => {
    const bad = "../../../etc/edgar-attacker";
    expect(() => sanitizePrimaryDoc(bad)).toThrow(
      `Refusing unsafe primary_doc name: ${JSON.stringify(bad)}`
    );
  });

  it("rejects an absolute POSIX path", () => {
    expect(() => sanitizePrimaryDoc("/etc/passwd")).toThrow(/Refusing unsafe primary_doc/);
  });

  it("rejects a name containing a NUL byte", () => {
    expect(() => sanitizePrimaryDoc("evil\0.htm")).toThrow(/Refusing unsafe primary_doc/);
  });

  it("rejects a name containing a backslash", () => {
    expect(() => sanitizePrimaryDoc("d\\evil.htm")).toThrow(/Refusing unsafe primary_doc/);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(() => sanitizePrimaryDoc("")).toThrow(/Refusing unsafe primary_doc/);
    expect(() => sanitizePrimaryDoc("   ")).toThrow(/Refusing unsafe primary_doc/);
  });

  it("returns the trimmed basename for a safe filename", () => {
    expect(sanitizePrimaryDoc("wf-form4.xml")).toBe("wf-form4.xml");
    expect(sanitizePrimaryDoc("  wf-form4.xml  ")).toBe("wf-form4.xml");
  });
});

describe("assertInsideDir", () => {
  it("accepts a normal join under the base directory", () => {
    const base = path.resolve("/tmp/accessiondocs/0001193125");
    const full = path.join(base, "000119312521066104-wf-form4.xml");
    expect(() => assertInsideDir(full, base)).not.toThrow();
  });

  it("rejects a composed path that escapes via `..`", () => {
    const base = path.resolve("/tmp/accessiondocs/0001193125");
    const escaping = path.join(base, "..", "..", "..", "etc", "edgar-attacker");
    expect(() => assertInsideDir(escaping, base)).toThrow(
      /Path escapes accession-doc directory/
    );
  });
});
