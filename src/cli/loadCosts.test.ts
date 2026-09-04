/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { confirmLoad, costsFor, LOAD_COSTS } from "./loadCosts";

describe("costsFor", () => {
  it("names the three archives `all` downloads, in order", () => {
    expect(costsFor("all").map((cost) => cost.id)).toEqual(["ciks", "submissions", "facts"]);
  });

  it("names one archive for a single type", () => {
    expect(costsFor("facts")).toEqual([LOAD_COSTS.facts]);
  });

  it("says nothing about a type it has no figure for, rather than inventing one", () => {
    expect(costsFor("nope")).toEqual([]);
  });
});

describe("confirmLoad", () => {
  it("does not ask when --yes was passed", async () => {
    expect(await confirmLoad(costsFor("all"), { yes: true })).toBe(true);
  });

  it("does not ask when there is no terminal to ask on", async () => {
    // A scripted run has already decided; blocking on a prompt nothing can
    // answer is how a pipeline hangs forever instead of failing.
    expect(process.stdin.isTTY).toBeFalsy();
    expect(await confirmLoad(costsFor("all"), {})).toBe(true);
  });
});
