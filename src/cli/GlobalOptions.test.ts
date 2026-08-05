import { Command, InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";
import {
  applyGlobalOptions,
  parseGlobalOptions,
  parseIntOption,
  parseOutputFormat,
} from "./GlobalOptions";

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  applyGlobalOptions(program);
  return program;
}

describe("GlobalOptions", () => {
  describe("applyGlobalOptions", () => {
    it("adds --dry-run to help text", () => {
      const program = createProgram();
      const help = program.helpInformation();
      expect(help).toContain("--dry-run");
    });

    it("advertises --json now that it is consumed", () => {
      const help = createProgram().helpInformation();
      expect(help).toContain("--json");
    });

    it("does not advertise the removed (never-consumed) flags", () => {
      const help = createProgram().helpInformation();
      expect(help).not.toContain("--verbose");
      expect(help).not.toContain("--no-color");
    });

    it("returns the program for chaining", () => {
      const program = new Command();
      const result = applyGlobalOptions(program);
      expect(result).toBe(program);
    });
  });

  describe("parseGlobalOptions", () => {
    it("defaults dryRun to false", () => {
      const program = createProgram();
      program.parse([], { from: "user" });
      expect(parseGlobalOptions(program).dryRun).toBe(false);
    });

    it("parses --dry-run", () => {
      const program = createProgram();
      program.parse(["--dry-run"], { from: "user" });
      expect(parseGlobalOptions(program).dryRun).toBe(true);
    });

    it("defaults json to false", () => {
      const program = createProgram();
      program.parse([], { from: "user" });
      expect(parseGlobalOptions(program).json).toBe(false);
    });

    it("parses --json", () => {
      const program = createProgram();
      program.parse(["--json"], { from: "user" });
      expect(parseGlobalOptions(program).json).toBe(true);
    });
  });

  describe("parseIntOption", () => {
    it("parses plain digit strings", () => {
      expect(parseIntOption("320193")).toBe(320193);
    });

    it("parses leading-zero digit strings", () => {
      expect(parseIntOption("007")).toBe(7);
    });

    it("parses zero", () => {
      expect(parseIntOption("0")).toBe(0);
    });

    const rejected: readonly string[] = [
      "320193abc",
      " abc123",
      "",
      "   ",
      "-5",
      "1.5",
      "0x10",
      "1e5",
      "99999999999999999999",
    ];

    for (const input of rejected) {
      it(`rejects ${JSON.stringify(input)} with the original value in the message`, () => {
        try {
          parseIntOption(input);
          throw new Error("expected parseIntOption to throw");
        } catch (err) {
          expect(err).toBeInstanceOf(InvalidArgumentError);
          expect((err as Error).message).toContain(`"${input}"`);
          expect((err as Error).message).toContain("non-negative integer");
        }
      });
    }
  });

  describe("parseOutputFormat", () => {
    it("accepts each supported format", () => {
      expect(parseOutputFormat("table")).toBe("table");
      expect(parseOutputFormat("csv")).toBe("csv");
      expect(parseOutputFormat("json")).toBe("json");
    });

    it("normalizes surrounding whitespace and case", () => {
      expect(parseOutputFormat("  JSON ")).toBe("json");
      expect(parseOutputFormat("Csv")).toBe("csv");
    });

    const rejected: readonly string[] = ["jsonl", "", "  ", "tsv", "TABLE!", "json5"];

    for (const input of rejected) {
      it(`rejects ${JSON.stringify(input)} rather than silently falling back to a table`, () => {
        try {
          parseOutputFormat(input);
          throw new Error("expected parseOutputFormat to throw");
        } catch (err) {
          expect(err).toBeInstanceOf(InvalidArgumentError);
          expect((err as Error).message).toContain(`"${input}"`);
          expect((err as Error).message).toContain("table | csv | json");
        }
      });
    }
  });
});
