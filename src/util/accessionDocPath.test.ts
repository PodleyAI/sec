/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertInsideDir, sanitizePrimaryDoc, stripXslPrefix } from "./accessionDocPath";

describe("stripXslPrefix", () => {
  it("strips the EDGAR inline-XBRL viewer prefix", () => {
    expect(stripXslPrefix("xslF345X03/wf-form4.xml")).toBe("wf-form4.xml");
    expect(stripXslPrefix("xslF345X02/b.xml")).toBe("b.xml");
  });

  it("leaves a bare filename untouched", () => {
    expect(stripXslPrefix("wf-form4.xml")).toBe("wf-form4.xml");
    expect(stripXslPrefix("")).toBe("");
  });

  it("strips at most one prefix, and only when anchored at the start", () => {
    // The pattern is anchored, so a second segment is left alone and an
    // interior occurrence is never touched.
    expect(stripXslPrefix("xslA/xslB/foo.xml")).toBe("xslB/foo.xml");
    expect(stripXslPrefix("a/xslF345X03/b.xml")).toBe("a/xslF345X03/b.xml");
    expect(stripXslPrefix("primary_docxsl/x.htm")).toBe("primary_docxsl/x.htm");
  });

  it("requires a non-empty segment after 'xsl' and is case-sensitive", () => {
    expect(stripXslPrefix("xsl/foo.xml")).toBe("xsl/foo.xml");
    expect(stripXslPrefix("XSLF345X03/wf-form4.xml")).toBe("XSLF345X03/wf-form4.xml");
  });

  it("does not trim, so callers control the order", () => {
    expect(stripXslPrefix("  xslFoo/bar.htm  ")).toBe("  xslFoo/bar.htm  ");
  });
});

describe("stripXslPrefix composed with sanitizePrimaryDoc", () => {
  it("accepts a viewer-prefixed ownership document", () => {
    expect(sanitizePrimaryDoc(stripXslPrefix("xslF345X03/wf-form4.xml"))).toBe("wf-form4.xml");
  });

  it("still rejects traversal that a stripped prefix would otherwise hide", () => {
    // Stripping a known-safe prefix must not open a hole: whatever survives
    // the strip still faces the traversal guard.
    for (const evil of [
      "../../etc/passwd",
      "xslFoo/../../etc/passwd",
      "/etc/passwd",
      "xslFoo//etc/passwd",
      "xslFoo/sub/dir/x.htm",
    ]) {
      expect(() => sanitizePrimaryDoc(stripXslPrefix(evil))).toThrow(/Refusing unsafe primary_doc/);
    }
  });
});

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
    expect(() => assertInsideDir(escaping, base)).toThrow(/Path escapes accession-doc directory/);
  });
});
