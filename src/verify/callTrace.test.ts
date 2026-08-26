/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractManagement } from "../sec/forms/registration-statements/s1/sectionExtractors";
import {
  fakeS1Model,
  registerFakeStructuredProvider,
} from "../sec/forms/registration-statements/s1/testing/fakeStructuredProvider";
import {
  callsFilePath,
  isCallTracing,
  resetCallTracingForTesting,
  sectionFilePath,
  sectionHash,
  type CallRecord,
} from "./callTrace";
import { readCallTrace } from "./readCallTrace";

let cleanup: (() => void) | undefined;
const original = process.env.SEC_TRACE_DIR;

beforeEach(() => {
  resetCallTracingForTesting();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  if (original === undefined) delete process.env.SEC_TRACE_DIR;
  else process.env.SEC_TRACE_DIR = original;
  resetCallTracingForTesting();
});

function traceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sec-calltrace-"));
  process.env.SEC_TRACE_DIR = dir;
  resetCallTracingForTesting();
  return dir;
}

function records(dir: string): CallRecord[] {
  const path = callsFilePath(dir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CallRecord);
}

const SECTION = "Jane Roe has served as our Chief Executive Officer since 2021.";

describe("call tracing", () => {
  it("writes nothing at all when SEC_TRACE_DIR is unset", async () => {
    delete process.env.SEC_TRACE_DIR;
    resetCallTracingForTesting();
    expect(isCallTracing()).toBe(false);
    const fake = registerFakeStructuredProvider([{ people: [] }]);
    cleanup = fake.unregister;
    await extractManagement(SECTION, fakeS1Model());
    // Nothing to assert a path against — the point is that the extractor ran
    // and the facility stayed inert, which `isCallTracing` already reports.
    expect(isCallTracing()).toBe(false);
  });

  it("records a successful call with its parsed object", async () => {
    const dir = traceDir();
    const fake = registerFakeStructuredProvider([
      {
        people: [
          {
            full_name: "Jane Roe",
            titles: ["Chief Executive Officer"],
            relationship: null,
            age: null,
            bio: null,
            confidence: 0.9,
            source_span: SECTION,
          },
        ],
      },
    ]);
    cleanup = fake.unregister;

    await extractManagement(SECTION, fakeS1Model());

    const written = records(dir);
    expect(written).toHaveLength(1);
    const call = written[0]!;
    expect(call.label).toBe("management");
    expect(call.outcome).toBe("ok");
    expect(call.attempt).toBe(1);
    expect(call.instructions).toContain("Extract every director and executive officer");
    expect((call.object?.people as unknown[])?.length).toBe(1);
    expect(call.errorMessage).toBeUndefined();
  });

  /**
   * The section prose is written once and referenced by hash. A record that
   * inlined it would repeat a 246k risk-factors section on every attempt.
   */
  it("stores the section prose once, referenced by hash", async () => {
    const dir = traceDir();
    const fake = registerFakeStructuredProvider([{ people: [] }, { people: [] }]);
    cleanup = fake.unregister;

    await extractManagement(SECTION, fakeS1Model());
    await extractManagement(SECTION, fakeS1Model());

    const written = records(dir);
    expect(written).toHaveLength(2);
    const hash = sectionHash(SECTION);
    expect(written.every((r) => r.sectionSha256 === hash)).toBe(true);
    expect(written.every((r) => r.sectionChars === SECTION.length)).toBe(true);
    expect(readFileSync(sectionFilePath(dir, hash), "utf-8")).toBe(SECTION);
  });

  /**
   * A schema rejection is the outcome worth tracing most: it is the one where
   * the model's actual output is otherwise thrown away, and the extractor's
   * retry loop hides how many rounds it cost.
   */
  it("records each attempt of a call whose output never validates", async () => {
    const dir = traceDir();
    // `people` must be an array; a string fails the schema on every attempt.
    const fake = registerFakeStructuredProvider([
      { people: "not an array" },
      { people: "not an array" },
      { people: "not an array" },
      { people: "not an array" },
    ]);
    cleanup = fake.unregister;

    await expect(extractManagement(SECTION, fakeS1Model())).rejects.toThrow();

    const written = records(dir);
    expect(written.length).toBeGreaterThanOrEqual(1);
    expect(written.every((r) => r.outcome === "invalid-output")).toBe(true);
    // The rejected object and why it was rejected both survive.
    const attempts = written[0]!.validationAttempts;
    expect(attempts?.length).toBeGreaterThanOrEqual(1);
    expect(attempts?.[0]?.errors.length).toBeGreaterThanOrEqual(1);
    expect(attempts?.[0]?.object).toEqual({ people: "not an array" });
    // Retries inside the extractor show up as separate records, in order.
    expect(written.map((r) => r.attempt)).toEqual(written.map((_, index) => index + 1));
  });

  /**
   * The summary is what an operator reads after a sweep. `sections` counts
   * distinct prose, so calls-per-section is the retry cost — the number that
   * says a model is schema-flaky rather than merely slow.
   */
  it("summarizes a trace by extractor and model", async () => {
    const dir = traceDir();
    const ok = registerFakeStructuredProvider([{ people: [] }]);
    await extractManagement(SECTION, fakeS1Model());
    ok.unregister();
    const bad = registerFakeStructuredProvider([
      { people: 1 },
      { people: 1 },
      { people: 1 },
      { people: 1 },
    ]);
    cleanup = bad.unregister;
    await expect(extractManagement("A different section.", fakeS1Model())).rejects.toThrow();

    const summary = readCallTrace(dir);
    expect(summary.calls).toBe(4);
    expect(summary.unreadable).toBe(0);
    expect(summary.byOutcome).toEqual({ ok: 1, "invalid-output": 3 });
    expect(summary.groups).toHaveLength(1);
    const group = summary.groups[0]!;
    expect(group.label).toBe("management");
    expect(group.calls).toBe(4);
    expect(group.sections).toBe(2);
    expect(group.retries).toBe(2);
  });

  /** A sweep killed mid-append leaves a partial line; the rest must still read. */
  it("counts an unparsable trailing line instead of refusing the file", async () => {
    const dir = traceDir();
    const fake = registerFakeStructuredProvider([{ people: [] }]);
    cleanup = fake.unregister;
    await extractManagement(SECTION, fakeS1Model());
    appendFileSync(callsFilePath(dir), '{"seq":1,"label":"trunc', "utf-8");

    const summary = readCallTrace(dir);
    expect(summary.calls).toBe(1);
    expect(summary.unreadable).toBe(1);
  });
});
