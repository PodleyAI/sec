/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `sec issuer` collects subcommands registered from unrelated places, and once
 * the identity tier is a downstream package's, from a different repository.
 * What is pinned here is that no registrant creates the group for another: each
 * finds it or makes it, so neither order nor the absence of the other decides
 * whether a subcommand exists.
 */

import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { issuerCommandGroup } from "./issuerGroup";

function names(program: Command): string[] {
  const issuer = program.commands.find((c) => c.name() === "issuer");
  return (issuer?.commands ?? []).map((c) => c.name()).sort();
}

describe("issuerCommandGroup", () => {
  it("creates the group once and returns the same one thereafter", () => {
    const program = new Command();
    const first = issuerCommandGroup(program);
    const second = issuerCommandGroup(program);

    expect(second).toBe(first);
    expect(program.commands.filter((c) => c.name() === "issuer")).toHaveLength(1);
  });

  it("collects subcommands whichever order they register in", () => {
    for (const order of [
      ["alpha", "beta"],
      ["beta", "alpha"],
    ]) {
      const program = new Command();
      for (const name of order) {
        issuerCommandGroup(program).addCommand(new Command(name).description(name));
      }
      expect(names(program)).toEqual(["alpha", "beta"]);
    }
  });

  it("gives a lone registrant a working group", () => {
    // The case the split has to survive: one registrant moves to another
    // package and stops registering here at all.
    const program = new Command();
    issuerCommandGroup(program).addCommand(new Command("solo").description("solo"));

    expect(names(program)).toEqual(["solo"]);
    expect(program.commands.find((c) => c.name() === "issuer")?.description()).toBe(
      "Issuer queries"
    );
  });
});
