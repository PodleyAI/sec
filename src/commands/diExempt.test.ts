/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { isDiExemptCommand } from "./index";

/** Build a program shaped like a command path and return the leaf. */
function leafOf(...path: readonly string[]): Command {
  let node = new Command("sec");
  for (const name of path) node = node.command(name);
  return node;
}

describe("isDiExemptCommand", () => {
  it("exempts a leaf-named command", () => {
    expect(isDiExemptCommand(leafOf("init"))).toBe(true);
    expect(isDiExemptCommand(leafOf("golden-fixtures"))).toBe(true);
  });

  it("exempts every verify leaf, which reads files rather than a database", () => {
    for (const leaf of ["parse", "sections", "chunks", "all", "fixtures", "calls"]) {
      expect(isDiExemptCommand(leafOf("verify", leaf)), `verify ${leaf}`).toBe(true);
    }
  });

  /**
   * The reason `verify` is matched by path and not by leaf name. `sync all`
   * needs a database, and exempting it would defer the failure from the gate to
   * whatever first touched a repository.
   */
  it("does not exempt a same-named leaf under a different group", () => {
    expect(isDiExemptCommand(leafOf("sync", "all"))).toBe(false);
    expect(isDiExemptCommand(leafOf("query", "filings"))).toBe(false);
    expect(isDiExemptCommand(leafOf("extractor", "backfill"))).toBe(false);
  });
});
