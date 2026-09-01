/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { clearFormExtractorsForTesting, registerFormExtractor } from "../sec/forms/formExtractors";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../storage/versioning/ComponentVersionSchema";
import { getActiveSlot } from "../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../storage/versioning/VersionRegistry";
import { ComputeFormsWorklistTask } from "../task/forms/ComputeFormsWorklistTask";
import { registerSecFormExtractors } from "./registerFormExtractors";
import { resetDependencyInjectionsForTesting } from "./TestingDI";
import { setupAllDatabases } from "./setupAllDatabases";

/**
 * A version slot is what lets an extractor be selected, run and recorded. The
 * form-extractor registry is open — a downstream package registers its own
 * extractors through it — so seeding slots from a list this package holds gave
 * every such extractor no slot at all.
 *
 * The fixture is one extractor sec does not ship, registered through nothing
 * but the public seam. It carries a `section`, both because that keeps the
 * registration additive rather than replacing a shipped key and because the
 * slot is keyed by ID: the registry key is `id:section`, and a seeder that
 * confused the two would mint `downstream-milestone:deal-terms` and leave
 * every lookup below unresolved.
 */
const DOWNSTREAM_ID = "downstream-milestone";
const DOWNSTREAM_SECTION = "deal-terms";
/** A real EDGAR form symbol no extractor sec ships handles. */
const DOWNSTREAM_FORM = "8-K12B";

const noopStore = async (): Promise<void> => {};

async function seedFiling(accession_number: string, form: string): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: 11,
    accession_number,
    form,
    primary_doc: "primary.htm",
    file_number: "",
    filing_date: "2026-04-02",
    acceptance_date: "2026-04-02T00:00:00.000Z",
    report_date: "2026-04-02",
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  } as never);
}

/** Runs `fn` with `console.error` captured, so a reported failure can be read. */
async function captureErrors<T>(
  fn: () => Promise<T>
): Promise<{ readonly result: T; readonly errors: readonly string[] }> {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => {
    errors.push(String(message ?? ""));
  };
  try {
    return { result: await fn(), errors };
  } finally {
    console.error = originalError;
  }
}

beforeAll(() => {
  // Register sec's own extractors FIRST so the once-per-generation guard is
  // armed: a later `registerSecFormExtractors()` (setupAllDatabases makes one)
  // is then a no-op and cannot replace the registration below.
  registerSecFormExtractors();
  registerFormExtractor({
    id: DOWNSTREAM_ID,
    section: DOWNSTREAM_SECTION,
    forms: [DOWNSTREAM_FORM],
    store: noopStore,
  });
});

afterAll(() => {
  // Leave the registry as it was found: clearing re-arms `registerSecFormExtractors`.
  clearFormExtractorsForTesting();
  registerSecFormExtractors();
});

describe("db setup seeds a version slot for an extractor it does not ship", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("seeds the current slot at 1.0.0 for a registry-only extractor", async () => {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    const slot = await reg.getCurrent("extractor", DOWNSTREAM_ID);
    expect(slot?.semver).toBe("1.0.0");
    expect(slot?.coverage_complete).toBe(true);
  });

  it("seeds the slot under the extractor id, never the sectioned registry key", async () => {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    expect(
      await reg.getCurrent("extractor", `${DOWNSTREAM_ID}:${DOWNSTREAM_SECTION}`)
    ).toBeUndefined();
  });

  it("resolves an active slot for it, so a version map cannot silently drop it", async () => {
    // The lookup `loadActiveExtractorVersions` makes per id. Missing, it skips
    // the id — and every consumer of that map (the `spac process --force all`
    // reset among them) then has no entry for the extractor.
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    const active = await getActiveSlot(reg, "extractor", DOWNSTREAM_ID);
    expect(active?.semver).toBe("1.0.0");
    expect(active?.slot).toBe("current");
  });

  it("selects its filings into the forms worklist", async () => {
    await seedFiling("0001111111-26-000001", DOWNSTREAM_FORM);

    const out = await new ComputeFormsWorklistTask({ defaults: {} }).run({
      form: [DOWNSTREAM_FORM],
    });

    expect(out.count).toBe(1);
    expect(out.accessionNumber).toEqual(["0001111111-26-000001"]);
  });

  it("still seeds every extractor sec ships", async () => {
    // The registry-derived seed must not have narrowed the shipped set: the
    // known-SPAC 8-K detectors run inside the 8-K extractor's `store` and
    // register no form of their own, so the form registry alone never names them.
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    for (const id of ["D", "S-1", "8-K", "merger-proxy", "redemption", "loi"]) {
      expect(await reg.getCurrent("extractor", id)).toBeDefined();
    }
  });
});

/**
 * A slot that genuinely cannot be resolved, which after the change above needs
 * an extractor registered later than the `db setup` that seeded — something the
 * open registry makes reachable. The failure stays loud, but it is scoped to
 * the form whose extractor lacks a slot: the sweep's other forms have nothing
 * to do with that extractor and their work must survive it.
 */
describe("an unresolvable slot", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("fails only the form whose extractor lacks one, and the sweep carries on", async () => {
    const lateForm = "F-4";
    const lateId = "downstream-late";
    await seedFiling("0001111111-26-000002", "D");
    await seedFiling("0001111111-26-000003", lateForm);

    // The same sweep, before anything is registered late: Form D alone works.
    const ok = await new ComputeFormsWorklistTask({ defaults: {} }).run({ form: ["D"] });
    expect(ok.count).toBe(1);

    registerFormExtractor({ id: lateId, forms: [lateForm], store: noopStore });

    const { result, errors } = await captureErrors(() =>
      new ComputeFormsWorklistTask({ defaults: {} }).run({ form: ["D", lateForm] })
    );

    // Form D's filing still comes back; only the unversioned form is dropped.
    expect(result.count).toBe(1);
    expect(result.accessionNumber).toEqual(["0001111111-26-000002"]);
    expect(result.form).toEqual(["D"]);

    // And the drop is reported rather than swallowed, naming both the form and
    // the extractor that could not be versioned.
    const reported = errors.join("\n");
    expect(reported).toContain(`'${lateForm}'`);
    expect(reported).toContain(`No active slot for extractor '${lateId}'`);
  });
});

/**
 * `db setup` also runs from `sec init`, which skips the preAction hook that
 * otherwise brings the runtime up, and the ids it seeds are now read out of a
 * registry. Emptying that registry first is what makes this a test of the call
 * site rather than of whichever import happened to populate it earlier in the
 * process.
 */
describe("db setup populates the registry it seeds from", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    clearFormExtractorsForTesting();
    await setupAllDatabases();
  });

  it("seeds the shipped extractors from an empty registry", async () => {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    for (const id of ["D", "C", "S-1", "424", "8-K", "3", "RW"]) {
      expect(await reg.getCurrent("extractor", id)).toBeDefined();
    }
  });
});
