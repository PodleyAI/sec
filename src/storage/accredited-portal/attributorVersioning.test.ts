/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { computeResolverCoverage } from "../../cli/queries/ResolverCoverage";
import { PortalAttributor } from "../../resolver/PortalAttributor";
import { dropPrevious } from "../versioning/ceremonies";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../versioning/ComponentVersionSchema";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "../versioning/VersionEventSchema";
import { VersionEventRepo } from "../versioning/VersionEventRepo";
import { VersionRegistry } from "../versioning/VersionRegistry";
import { AccreditedPortalSignalRepo } from "./AccreditedPortalSignalRepo";
import { FormDPortalAttributionRepo } from "./FormDPortalAttributionRepo";

async function attributeAt(version: string, accession: string): Promise<void> {
  await new PortalAttributor({ attributorVersion: version }).attribute({
    accession_number: accession,
    cik: null,
    filing_date: null,
    candidates: [{ signal_type: "name", signal_value: "percent", via: "form-d:primary-issuer" }],
  });
}

describe("portal-attributor version ceremonies", () => {
  let attributionRepo: FormDPortalAttributionRepo;
  let reg: VersionRegistry;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    attributionRepo = new FormDPortalAttributionRepo();
    reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    await new AccreditedPortalSignalRepo().saveSignal({
      signal_type: "name",
      signal_value: "percent",
      portal_id: "percent",
      source: "manual",
      note: null,
      created_at: new Date().toISOString(),
    });
  });

  it("stamps rows with the provided attributor version", async () => {
    await attributeAt("1.1.0", "0000000001-26-000100");
    const row = await attributionRepo.getAttribution("0000000001-26-000100", "percent");
    expect(row?.attributor_version).toBe("1.1.0");
  });

  it("coverage reports the fraction of rows at the queried version", async () => {
    await attributeAt("1.0.0", "0000000001-26-000101");
    await attributeAt("1.1.0", "0000000001-26-000102");
    const coverage = await computeResolverCoverage("portal-attributor", "1.1.0");
    expect(coverage.numerator).toBe(1);
    expect(coverage.denominator).toBe(2);
    expect(coverage.fraction).toBe(0.5);
  });

  it("drop-previous purges rows written at the retired version", async () => {
    await attributeAt("1.0.0", "0000000001-26-000103");
    await attributeAt("1.1.0", "0000000001-26-000104");

    // Simulate a completed promote: previous=1.0.0, current=1.1.0.
    await reg.putSlot({
      component_kind: "resolver",
      component_id: "portal-attributor",
      slot: "previous",
      semver: "1.0.0",
      bump_type: null,
      started_at: new Date().toISOString(),
      coverage_complete: true,
      target_count: null,
    });
    await reg.putSlot({
      component_kind: "resolver",
      component_id: "portal-attributor",
      slot: "current",
      semver: "1.1.0",
      bump_type: "minor",
      started_at: new Date().toISOString(),
      coverage_complete: true,
      target_count: null,
    });

    await dropPrevious({
      reg,
      events: new VersionEventRepo(globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN)),
      kind: "resolver",
      id: "portal-attributor",
    });

    expect(await attributionRepo.countAtVersion("1.0.0")).toBe(0);
    expect(await attributionRepo.countAtVersion("1.1.0")).toBe(1);
    expect(await reg.getPrevious("resolver", "portal-attributor")).toBeUndefined();
  });
});
