/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { addExtractorCommands, countEligibleDeadLetters } from "./extractor";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";

describe("countEligibleDeadLetters", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => resetDependencyInjectionsForTesting());

  it("counts pending entries that failed under a different version than current", async () => {
    const dl = new ExtractionDeadLetterRepo();
    await dl.record({
      extractor_id: "S-1",
      accession_number: "a",
      section_name: "Management",
      reason_code: "MODEL_EMPTY",
      detail: null,
      failed_extractor_version: "0.9.0",
      source_run_id: null,
    });
    expect(await countEligibleDeadLetters("S-1")).toBe(1);
  });
});

describe("extractor dead-letters CLI", () => {
  it("accepts an optional extractor id and a --cik filter", () => {
    const program = new Command("sec");
    addExtractorCommands(program);
    const extractor = program.commands.find((command) => command.name() === "extractor");
    const deadLetters = extractor?.commands.find((command) => command.name() === "dead-letters");
    expect(deadLetters).toBeDefined();
    expect(deadLetters!.registeredArguments[0]?.required).toBe(false);
    const cikOption = deadLetters!.options.find((option) => option.long === "--cik");
    expect(cikOption?.parseArg).toBeTypeOf("function");
    expect(() => cikOption!.parseArg!("", undefined)).toThrow('"" is not a non-negative integer.');
  });
});
