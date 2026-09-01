/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DRY_RUN } from "../../config/tokens";
import { ComputeFormsWorklistTask } from "../../task/forms/ComputeFormsWorklistTask";
import { runFormsSweep } from "./runFormsSweep";
import { SYNC_FORM_DOMAINS, expandFormTypes, formsForExtractorIds } from "./syncFormDomains";

/**
 * A request that resolved to no forms and a request never made are different
 * things, and both directions are asserted here so neither can be collapsed
 * into the other. A named request that expands to nothing is an error; an
 * absent one is the deliberate full-corpus default.
 */

/** An extractor id nothing registers — the shape a stale sync domain has. */
const UNREGISTERED_ID = "no-such-extractor";

/** The forms named in the worklist's dry-run line, in the order it prints them. */
async function dryRunForms(input: { readonly form?: string[] }): Promise<string[]> {
  globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message ?? ""));
  };
  try {
    await new ComputeFormsWorklistTask({ defaults: {} }).run(input);
  } finally {
    console.log = originalLog;
  }
  const line = logs.find((l) => l.startsWith("Would process"));
  if (line === undefined) throw new Error(`no dry-run line in: ${logs.join(" | ")}`);
  const marker = "forms: ";
  return line.slice(line.indexOf(marker) + marker.length).split(", ");
}

describe("a form request that expanded to nothing", () => {
  it("is refused rather than widened into a full-corpus sweep", async () => {
    expect(formsForExtractorIds([UNREGISTERED_ID])).toEqual([]);

    await expect(
      runFormsSweep({
        formTypes: formsForExtractorIds([UNREGISTERED_ID]),
        requestedFrom: `sync domain '${UNREGISTERED_ID}'`,
      })
    ).rejects.toThrow(/resolved to no forms to sweep/);
  });

  it("is refused for CLI tokens too, and names what asked", async () => {
    // `expandFormTypes` passes an unrecognised token through, so reaching an
    // empty list from the CLI takes an empty token list — the same shape.
    expect(expandFormTypes([])).toEqual([]);

    await expect(
      runFormsSweep({ formTypes: expandFormTypes([]), requestedFrom: "tokens ''" })
    ).rejects.toThrow(/tokens ''/);
  });
});

describe("a form request never made", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("still sweeps every form, not one domain's worth", async () => {
    const named = await dryRunForms({});

    const domainForms = Object.values(SYNC_FORM_DOMAINS).flatMap((ids) =>
      formsForExtractorIds(ids)
    );
    expect(domainForms.length).toBeGreaterThan(0);
    for (const form of domainForms) {
      expect(named, `expected the default sweep to include ${form}`).toContain(form);
    }
    // Wider than the union of every domain: the insider-trading forms belong
    // to no sync domain at all. (Form RW used to stand beside them here; it
    // routes nowhere in a sec-only deployment now, so it reaches no sweep at
    // all rather than reaching this one outside a domain.)
    expect(named).toContain("3");
    expect(named).toContain("144");
    expect(named.length).toBeGreaterThan(domainForms.length);
  });

  it("is what an empty --form list means too, since nothing was named", async () => {
    // Not a distinction the worklist could draw even if it wanted to: an
    // omitted optional array port reaches `execute` as `[]`, so both calls
    // below hand it the identical input. That is exactly why the refusal
    // above lives in `runFormsSweep`, which can still see that a request was
    // made, and why turning an empty list into an error HERE would break the
    // full sweep instead of catching a stale request.
    expect(await dryRunForms({ form: [] })).toEqual(await dryRunForms({}));
  });
});
