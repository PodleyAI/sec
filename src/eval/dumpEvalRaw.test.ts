/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { formatEvalRawDump, shouldDumpEvalRaw, writeEvalRawDump } from "./dumpEvalRaw";

describe("shouldDumpEvalRaw", () => {
  const rows = { kind: "rows" as const, rows: [{ a: 1 }] };

  it("dumps hard failures when raw is present", () => {
    expect(shouldDumpEvalRaw({ ok: false, raw: rows, diff: undefined })).toBe(true);
  });

  it("does not dump when raw is absent", () => {
    expect(shouldDumpEvalRaw({ ok: false, raw: undefined, diff: undefined })).toBe(false);
  });

  it("dumps successful runs only when diff is non-empty", () => {
    expect(
      shouldDumpEvalRaw({
        ok: true,
        raw: rows,
        diff: { missing: ["x"], extra: [], mismatches: [] },
      })
    ).toBe(true);
    expect(
      shouldDumpEvalRaw({
        ok: true,
        raw: rows,
        diff: { missing: [], extra: [], mismatches: [] },
      })
    ).toBe(false);
  });
});

describe("formatEvalRawDump / writeEvalRawDump", () => {
  it("pretty-prints validation attempts", () => {
    const text = formatEvalRawDump({
      kind: "validation",
      attempts: [
        {
          attempt: 1,
          errors: [{ path: "/", message: "bad" }],
          object: { x: 1 },
        },
      ],
    });
    expect(text).toContain('"kind": "validation"');
    expect(text).toContain('"x": 1');
  });

  it("writes a labeled block via the sink", () => {
    const lines: string[] = [];
    writeEvalRawDump("model / fixture", { kind: "none" }, (s) => lines.push(s));
    expect(lines.join("\n")).toContain("--- raw (none)");
    expect(lines.join("\n")).toContain("model / fixture");
  });
});
