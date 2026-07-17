import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { applyGlobalOptions, parseGlobalOptions } from "./GlobalOptions";

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
});
