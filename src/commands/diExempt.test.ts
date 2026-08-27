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

  /**
   * The contract a superset CLI depends on.
   *
   * embarc-data installs its own preAction hook that calls `createStorage()`,
   * which reads `sec.db.type` — a token only sec's bootstrap registers. It must
   * decide whether to skip with THIS function and nothing else. Testing a
   * different condition has broken the superset twice: once when
   * `golden-fixtures` joined a set embarc-data restated locally, and again when
   * `verify` needed path matching and sec grew a second set the superset never
   * consulted.
   *
   * So the sets themselves are not exported. This asserts that a caller holding
   * only a `Command` — all a preAction hook receives — can answer the question.
   */
  it("answers from a Command alone, so a superset needs no other export", () => {
    const hookSaw: Command = leafOf("verify", "fixtures");
    expect(isDiExemptCommand(hookSaw)).toBe(true);
    expect(typeof isDiExemptCommand).toBe("function");
  });
});

describe("isDiExemptCommand — verify stages", () => {
  /** A verify stage as commander hands it to a preAction hook. */
  function verifyStage(leaf: string, argv: readonly string[]): Command {
    const program = new Command("sec");
    const group = program.command("verify");
    const cmd = group
      .command(`${leaf} [accession]`)
      .option("--cik <cik>", "CIK", (v) => Number(v))
      .option("--fixture <name>", "fixture")
      .action(() => {});
    program.parse(["node", "sec", "verify", leaf, ...argv]);
    return cmd;
  }

  it("exempts the fixture form, which reads a committed file", () => {
    expect(isDiExemptCommand(verifyStage("parse", ["--fixture", "s1_1.htm"]))).toBe(true);
  });

  /**
   * The accession form reads `filings.primary_doc` and the fetch cache, so it
   * needs exactly the tokens the bootstrap registers. Exempting it would make
   * it fail on every machine rather than degrade.
   */
  it("does not exempt the accession form", () => {
    expect(isDiExemptCommand(verifyStage("sections", ["--cik", "1849470", "0001-21-1"]))).toBe(
      false
    );
    expect(isDiExemptCommand(verifyStage("all", ["0001104659-21-035696"]))).toBe(false);
  });
});
