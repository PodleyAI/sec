import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { applyGlobalOptions, parseGlobalOptions } from "./GlobalOptions";

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  applyGlobalOptions(program);
  return program;
}

describe("GlobalOptions", () => {
  describe("applyGlobalOptions", () => {
    it("adds all flags to help text", () => {
      const program = createProgram();
      const help = program.helpInformation();
      expect(help).toContain("--json");
      expect(help).toContain("--verbose");
      expect(help).toContain("--dry-run");
      expect(help).toContain("--no-color");
    });

    it("returns the program for chaining", () => {
      const program = new Command();
      const result = applyGlobalOptions(program);
      expect(result).toBe(program);
    });
  });

  describe("parseGlobalOptions defaults", () => {
    it("returns correct defaults when no flags are set", () => {
      const program = createProgram();
      program.parse([], { from: "user" });
      const opts = parseGlobalOptions(program);
      expect(opts.json).toBe(false);
      expect(opts.verbose).toBe(false);
      expect(opts.dryRun).toBe(false);
      expect(opts.color).toBe(true);
    });
  });

  describe("parseGlobalOptions with flags", () => {
    it("parses --json", () => {
      const program = createProgram();
      program.parse(["--json"], { from: "user" });
      expect(parseGlobalOptions(program).json).toBe(true);
    });

    it("parses --verbose", () => {
      const program = createProgram();
      program.parse(["--verbose"], { from: "user" });
      expect(parseGlobalOptions(program).verbose).toBe(true);
    });

    it("parses --dry-run", () => {
      const program = createProgram();
      program.parse(["--dry-run"], { from: "user" });
      expect(parseGlobalOptions(program).dryRun).toBe(true);
    });

    it("parses --no-color", () => {
      const program = createProgram();
      program.parse(["--no-color"], { from: "user" });
      expect(parseGlobalOptions(program).color).toBe(false);
    });

    it("parses all flags together", () => {
      const program = createProgram();
      program.parse(["--json", "--verbose", "--dry-run", "--no-color"], {
        from: "user",
      });
      const opts = parseGlobalOptions(program);
      expect(opts.json).toBe(true);
      expect(opts.verbose).toBe(true);
      expect(opts.dryRun).toBe(true);
      expect(opts.color).toBe(false);
    });
  });
});
