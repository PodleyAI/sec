/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { EVAL_EXTRACTORS } from "./fixtures";
import { printEvalPrompts } from "./printEvalPrompts";

describe("printEvalPrompts", () => {
  it("instructions mode prints the static builder once per extractor", () => {
    const lines: string[] = [];
    printEvalPrompts({
      mode: "instructions",
      items: [
        { extractor: "management", label: "management" },
        { extractor: "management", label: "dup" },
      ],
      write: (l) => lines.push(l),
    });
    const out = lines.join("\n");
    expect(out).toContain("=== management / instructions ===");
    expect(out).toContain(EVAL_EXTRACTORS.management.instructions().slice(0, 40));
    // Deduped: only one instructions block.
    expect(out.match(/=== management \/ instructions ===/g)?.length).toBe(1);
  });

  it("template mode includes the untrusted fence but not fixture prose", () => {
    const lines: string[] = [];
    printEvalPrompts({
      mode: "template",
      items: [{ extractor: "management", label: "management" }],
      write: (l) => lines.push(l),
    });
    const out = lines.join("\n");
    expect(out).toContain("<UNTRUSTED_FILER_DOCUMENT>");
    expect(out).toContain("</UNTRUSTED_FILER_DOCUMENT>");
    expect(out).not.toContain("Marcus T. Delgado");
  });

  it("full mode includes section prose inside the fence", () => {
    const lines: string[] = [];
    printEvalPrompts({
      mode: "full",
      items: [
        {
          extractor: "management",
          label: "s1-management-operating-company",
          sectionText: "Marcus T. Delgado, age 54, has served as our Chief Executive Officer.",
        },
      ],
      write: (l) => lines.push(l),
    });
    const out = lines.join("\n");
    expect(out).toContain("=== management / s1-management-operating-company ===");
    expect(out).toContain("Marcus T. Delgado");
  });

  it("throws when items is empty", () => {
    expect(() => printEvalPrompts({ mode: "instructions", items: [] })).toThrow(
      /no extractors|nothing to print/i
    );
  });

  it("throws in full mode when an item lacks sectionText", () => {
    expect(() =>
      printEvalPrompts({
        mode: "full",
        items: [{ extractor: "management", label: "x" }],
      })
    ).toThrow(/sectionText|full/i);
  });

  it("schema mode prints pretty JSON once per extractor", () => {
    const lines: string[] = [];
    printEvalPrompts({
      mode: "schema",
      items: [
        { extractor: "management", label: "management" },
        { extractor: "management", label: "dup" },
      ],
      write: (l) => lines.push(l),
    });
    const out = lines.join("\n");
    expect(out).toContain("=== management / schema ===");
    expect(out.match(/=== management \/ schema ===/g)?.length).toBe(1);
    const jsonStart = out.indexOf("{");
    expect(jsonStart).toBeGreaterThan(-1);
    const parsed = JSON.parse(out.slice(jsonStart)) as {
      properties?: { people?: unknown; nonce_seen?: unknown };
    };
    expect(parsed.properties?.people).toBeDefined();
    expect(parsed.properties?.nonce_seen).toBeDefined();
  });

  it("schema mode does not require sectionText", () => {
    expect(() =>
      printEvalPrompts({
        mode: "schema",
        items: [{ extractor: "management", label: "x" }],
      })
    ).not.toThrow();
  });
});
