/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addEvalCommands } from "./eval";

/**
 * A value option passed with no value must answer with the values it accepts.
 * Declaring the option argument required hands the case to Commander, which
 * exits with a bare "argument missing" — the one moment the operator needs the
 * list is the one moment they don't get it.
 */
async function runEval(argv: readonly string[]): Promise<string> {
  const program = new Command();
  addEvalCommands(program);
  let stderr = "";
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      stderr += String(chunk);
      return true;
    });
  try {
    await program.parseAsync(["eval", ...argv], { from: "user" });
  } finally {
    spy.mockRestore();
  }
  return stderr;
}

async function runEvalOk(argv: readonly string[]): Promise<void> {
  const stderr = await runEval(argv);
  expect(stderr).toBe("");
  expect(process.exitCode).not.toBe(1);
}

describe("eval value-less options", () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it("lists the scorable extractors for a bare --extractor", async () => {
    const err = await runEval(["extract", "--extractor"]);
    expect(err).toContain("--extractor needs a value");
    expect(err).toContain("management");
    expect(err).toContain("risk-factors");
    // Registered in EVAL_EXTRACTORS but unfixtured — offering it would name a
    // value that errors out on the next run.
    expect(err).not.toContain("related-party");
    expect(process.exitCode).toBe(1);
  });

  it("lists the fixtures, grouped by extractor, for a bare --fixture", async () => {
    const err = await runEval(["extract", "--fixture"]);
    expect(err).toContain("--fixture needs a value");
    expect(err).toContain("management: s1-management-operating-company, s1-management-spac");
    expect(process.exitCode).toBe(1);
  });

  it("narrows the fixture list to --extractor when both are given", async () => {
    const err = await runEval(["extract", "--extractor", "management", "--fixture"]);
    expect(err).toContain("s1-management-spac");
    expect(err).not.toContain("loi-8k-clear-nonbinding-loi");
  });

  it("does not swallow the next flag as the missing value", async () => {
    const err = await runEval(["extract", "--extractor", "--format", "json"]);
    expect(err).toContain("--extractor needs a value");
  });

  it("treats an empty value as naming nothing, and still lists", async () => {
    const err = await runEval(["extract", "--fixture", " , "]);
    expect(err).toContain("--fixture was given but names nothing");
    expect(err).toContain("s1-management-spac");
  });

  it("names the model-id shapes for a bare --models", async () => {
    const err = await runEval(["extract", "--models"]);
    expect(err).toContain("--models needs a value");
    expect(err).toContain("claude-* (Anthropic)");
  });

  it("names both formats for a bare --format", async () => {
    const err = await runEval(["extract", "--format"]);
    expect(err).toContain("--format needs a value — one of: table, json");
  });

  it("covers eval s1's own value options", async () => {
    expect(await runEval(["s1", "--reference"])).toContain("'golden'");
    expect(await runEval(["s1", "--extractors"])).toContain("related-party");
    // The CIK list comes from the fixture corpus `--dir` selects.
    expect(await runEval(["s1", "--cik"])).toContain("2147219");
    expect(await runEval(["s1", "--format"])).toContain("one of: table, json");
  });

  it("covers eval unit-terms' value options", async () => {
    expect(await runEval(["unit-terms", "--models"])).toContain("claude-* (Anthropic)");
    expect(await runEval(["unit-terms", "--format"])).toContain("one of: table, json");
  });

  it("lists print-prompts modes for a bare --print-prompts on extract", async () => {
    const err = await runEval(["extract", "--print-prompts"]);
    expect(err).toContain("--print-prompts needs a value");
    expect(err).toContain("instructions");
    expect(err).toContain("template");
    expect(err).toContain("full");
    expect(process.exitCode).toBe(1);
  });

  it("rejects an unknown print-prompts mode", async () => {
    const err = await runEval(["extract", "--print-prompts", "nope"]);
    expect(err).toMatch(/print-prompts/i);
    expect(process.exitCode).toBe(1);
  });

  it("accepts --print-prompts on s1 and unit-terms (bare lists modes)", async () => {
    expect(await runEval(["s1", "--print-prompts"])).toContain("instructions");
    expect(await runEval(["unit-terms", "--print-prompts"])).toContain("full");
  });

  it("extract --print-prompts instructions dumps management text and does not need models", async () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => {
      lines.push(a.map(String).join(" "));
    });
    try {
      await runEvalOk(["extract", "--print-prompts", "instructions", "--extractor", "management"]);
    } finally {
      log.mockRestore();
    }
    const out = lines.join("\n");
    expect(out).toContain("=== management / instructions ===");
    expect(out).toContain("Extract every director and executive officer");
  });

  /**
   * The options that carried a Commander default (`--format`, `--reference`) had
   * to give it up: Commander resolves a value-less option to its default instead
   * of reporting it missing. The default now lives in the action, so an omitted
   * flag must still behave — checked here through the one path that does not run
   * a sweep.
   */
  it("still applies the default reference when --reference is omitted", async () => {
    // `--extractors` validation runs after the reference default is applied, so
    // an unknown extractor proves we got that far without a reference.
    const err = await runEval(["s1", "--extractors", "nope"]);
    expect(err).toContain('unknown extractor "nope"');
  });
});
