/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  callsFilePath,
  isCallTracing,
  recordCall,
  resetCallTracingForTesting,
  sectionFilePath,
  sectionHash,
  type CallRecord,
  type CallTraceInput,
} from "./callTrace";
import { readCallTrace } from "./readCallTrace";

const original = process.env.SEC_TRACE_DIR;

beforeEach(() => {
  resetCallTracingForTesting();
});

afterEach(() => {
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

const LABEL = "management";
const MODEL_ID = "fake-structured:fake-model";
const INSTRUCTIONS = "Extract every director and executive officer named in the section.";
const SECTION = "Jane Roe has served as our Chief Executive Officer since 2021.";
const PERSON = { full_name: "Jane Roe", titles: ["Chief Executive Officer"] };

/**
 * One model call, recorded the way a guarded extractor records one: the fields
 * that identify the call are the same on every attempt, and the caller scripts
 * how it ended. A synthetic caller keeps every case here about what the trace
 * stores, not about the retry loop that produced the calls.
 */
function traceCall(overrides: Partial<CallTraceInput> = {}): void {
  const sectionText = overrides.sectionText ?? SECTION;
  recordCall({
    label: LABEL,
    modelId: MODEL_ID,
    attempt: 1,
    nonce: false,
    durationMs: 7,
    outcome: "ok",
    prompt: `${INSTRUCTIONS}\n\n${sectionText}`,
    instructions: INSTRUCTIONS,
    sectionText,
    object: { people: [PERSON] },
    ...overrides,
  });
}

/** A call the model answered and the schema rejected, as the caller reports it. */
function traceRejectedCall(attempt: number, sectionText: string): void {
  traceCall({
    attempt,
    sectionText,
    outcome: "invalid-output",
    object: undefined,
    validationAttempts: [
      {
        attempt: 1,
        errors: [{ path: "/people", message: "Expected array" }],
        object: { people: "not an array" },
      },
    ],
    errorName: "StructuredOutputValidationError",
    errorMessage: "structured output failed validation",
  });
}

describe("call tracing", () => {
  it("writes nothing at all when SEC_TRACE_DIR is unset", () => {
    delete process.env.SEC_TRACE_DIR;
    resetCallTracingForTesting();
    expect(isCallTracing()).toBe(false);

    // The record is handed over anyway: staying inert with nowhere to write is
    // `recordCall`'s own contract, not something its callers arrange.
    traceCall();

    expect(isCallTracing()).toBe(false);
  });

  /**
   * Which directory a record goes to is re-decided from the environment, so a
   * directory that was configured earlier cannot keep collecting records after
   * the variable is gone.
   */
  it("stops writing once SEC_TRACE_DIR is removed", () => {
    const dir = traceDir();
    traceCall();
    expect(records(dir)).toHaveLength(1);

    delete process.env.SEC_TRACE_DIR;
    resetCallTracingForTesting();
    expect(isCallTracing()).toBe(false);

    traceCall();

    expect(records(dir)).toHaveLength(1);
  });

  it("records a successful call with its parsed object", () => {
    const dir = traceDir();

    traceCall();

    const written = records(dir);
    expect(written).toHaveLength(1);
    const call = written[0]!;
    expect(call.label).toBe(LABEL);
    expect(call.modelId).toBe(MODEL_ID);
    expect(call.outcome).toBe("ok");
    expect(call.attempt).toBe(1);
    expect(call.cached).toBe(false);
    expect(call.instructions).toContain("Extract every director and executive officer");
    expect(call.promptChars).toBe(`${INSTRUCTIONS}\n\n${SECTION}`.length);
    expect((call.object?.people as unknown[])?.length).toBe(1);
    expect(call.errorMessage).toBeUndefined();
  });

  /**
   * The section prose is written once and referenced by hash. A record that
   * inlined it would repeat a 246k risk-factors section on every attempt.
   */
  it("stores the section prose once, referenced by hash", () => {
    const dir = traceDir();

    traceCall();
    traceCall();

    const written = records(dir);
    expect(written).toHaveLength(2);
    const hash = sectionHash(SECTION);
    expect(written.every((r) => r.sectionSha256 === hash)).toBe(true);
    expect(written.every((r) => r.sectionChars === SECTION.length)).toBe(true);
    expect(readFileSync(sectionFilePath(dir, hash), "utf-8")).toBe(SECTION);
    // The prose lives in `sections/`, so no record carries a copy of it.
    expect(readFileSync(callsFilePath(dir), "utf-8")).not.toContain(SECTION);
  });

  /**
   * A schema rejection is the outcome worth tracing most: it is the one where
   * the model's actual output is otherwise thrown away, and the extractor's
   * retry loop hides how many rounds it cost.
   */
  it("records each attempt of a call whose output never validates", () => {
    const dir = traceDir();

    for (let attempt = 1; attempt <= 3; attempt++) traceRejectedCall(attempt, SECTION);

    const written = records(dir);
    expect(written).toHaveLength(3);
    expect(written.every((r) => r.outcome === "invalid-output")).toBe(true);
    // The rejected object and why it was rejected both survive.
    const attempts = written[0]!.validationAttempts;
    expect(attempts?.length).toBeGreaterThanOrEqual(1);
    expect(attempts?.[0]?.errors.length).toBeGreaterThanOrEqual(1);
    expect(attempts?.[0]?.object).toEqual({ people: "not an array" });
    // Retries reach the trace as separate records, in order.
    expect(written.map((r) => r.attempt)).toEqual(written.map((_, index) => index + 1));
  });

  /**
   * The summary is what an operator reads after a sweep. `sections` counts
   * distinct prose, so calls-per-section is the retry cost — the number that
   * says a model is schema-flaky rather than merely slow.
   */
  it("summarizes a trace by extractor and model", () => {
    const dir = traceDir();
    traceCall();
    for (let attempt = 1; attempt <= 3; attempt++) {
      traceRejectedCall(attempt, "A different section.");
    }

    const summary = readCallTrace(dir);
    expect(summary.calls).toBe(4);
    expect(summary.unreadable).toBe(0);
    expect(summary.byOutcome).toEqual({ ok: 1, "invalid-output": 3 });
    expect(summary.groups).toHaveLength(1);
    const group = summary.groups[0]!;
    expect(group.label).toBe(LABEL);
    expect(group.modelId).toBe(MODEL_ID);
    expect(group.calls).toBe(4);
    expect(group.sections).toBe(2);
    expect(group.retries).toBe(2);
  });

  /** A sweep killed mid-append leaves a partial line; the rest must still read. */
  it("counts an unparsable trailing line instead of refusing the file", () => {
    const dir = traceDir();
    traceCall();
    appendFileSync(callsFilePath(dir), '{"seq":1,"label":"trunc', "utf-8");

    const summary = readCallTrace(dir);
    expect(summary.calls).toBe(1);
    expect(summary.unreadable).toBe(1);
  });
});
