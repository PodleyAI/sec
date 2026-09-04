/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { isDiExemptCommand } from "./index";

/** A top-level command with the given name, options and positionals. */
function leaf(name: string, opts: Record<string, unknown> = {}, args: string[] = []): Command {
  const command = new Command("sec").command(name);
  Object.assign(command.opts(), opts);
  (command as unknown as { args: string[] }).args = args;
  return command;
}

/** A subcommand of a group, e.g. `db setup`. */
function nested(group: string, name: string): Command {
  return new Command("sec").command(group).command(name);
}

describe("isDiExemptCommand", () => {
  it("exempts setup, which is what you run when there is no configuration", () => {
    expect(isDiExemptCommand(leaf("setup"))).toBe(true);
  });

  it("exempts `read` on a file or a fixture, which touch no database", () => {
    expect(isDiExemptCommand(leaf("read", { file: "./filing.htm" }))).toBe(true);
    expect(isDiExemptCommand(leaf("read", { fixture: "s1_1083743" }))).toBe(true);
    expect(isDiExemptCommand(leaf("read", { fixtures: true }))).toBe(true);
    expect(isDiExemptCommand(leaf("read", {}, ["./local/filing.htm"]))).toBe(true);
  });

  /**
   * The accession form of the same command. Exempting it would not degrade
   * gracefully — `loadFilingHtml` would find no filing repository and refuse on
   * every machine, configured or not.
   */
  it("does not exempt `read` on an accession", () => {
    expect(isDiExemptCommand(leaf("read", {}, ["0001234567-25-000001"]))).toBe(false);
    expect(isDiExemptCommand(leaf("read", { cik: 320193 }, ["0001234567-25-000001"]))).toBe(false);
  });

  /**
   * `db setup` shares a leaf name with the top-level `setup` and is the exact
   * opposite case: it creates every table, so it needs every repository bound.
   * Exempting it leaves DI empty and the first `get` fails on a token.
   */
  it("does not exempt a same-named subcommand of a group", () => {
    expect(isDiExemptCommand(nested("db", "setup"))).toBe(false);
    expect(isDiExemptCommand(nested("show", "read"))).toBe(false);
  });

  it("exempts nothing else", () => {
    for (const name of ["status", "get", "update", "load", "show", "ask", "db"]) {
      expect(isDiExemptCommand(leaf(name)), name).toBe(false);
    }
  });
});
