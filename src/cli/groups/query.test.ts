import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { addQueryCommands } from "./query";

describe("query CIK options", () => {
  it("rejects an explicitly empty --cik instead of dropping the filter", () => {
    const program = new Command("sec");
    addQueryCommands(program);
    const query = program.commands.find((command) => command.name() === "query");
    expect(query).toBeDefined();

    for (const commandName of ["entities", "filings"]) {
      const command = query!.commands.find((candidate) => candidate.name() === commandName);
      const cikOption = command?.options.find((option) => option.long === "--cik");
      expect(cikOption?.parseArg).toBeTypeOf("function");
      expect(() => cikOption!.parseArg!("", undefined)).toThrow(
        '"" is not a non-negative integer.'
      );
    }
  });

  it("rejects an explicitly empty --sic on entities", () => {
    const program = new Command("sec");
    addQueryCommands(program);
    const query = program.commands.find((command) => command.name() === "query");
    const command = query!.commands.find((candidate) => candidate.name() === "entities");
    const option = command?.options.find((o) => o.long === "--sic");
    expect(option?.parseArg).toBeTypeOf("function");
    expect(() => option!.parseArg!("", undefined)).toThrow('"" is not a non-negative integer.');
  });
});
