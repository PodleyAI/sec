/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { AccreditedPortalRepo } from "./AccreditedPortalRepo";
import { AccreditedPortalSignalRepo } from "./AccreditedPortalSignalRepo";
import { importAccreditedPortals } from "./importAccreditedPortals";

describe("importAccreditedPortals", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("bootstraps portals and name signals from the embedded seed", async () => {
    const result = await importAccreditedPortals();
    expect(result.portals).toBeGreaterThan(20);
    expect(result.signalsSeeded).toBe(result.portals);

    const portals = await new AccreditedPortalRepo().getAllPortals();
    expect(portals.length).toBe(result.portals);

    const angellist = portals.find((p) => p.portal_id === "angellist");
    expect(angellist?.name).toBe("AngelList");
    expect(angellist?.live).toBe(true);
    expect(angellist?.featured).toBe(true);

    const seedinvest = portals.find((p) => p.portal_id === "seedinvest");
    expect(seedinvest?.live).toBe(false);

    const signal = await new AccreditedPortalSignalRepo().getSignal("name", "angellist");
    expect(signal?.portal_id).toBe("angellist");
    expect(signal?.source).toBe("seed");
  });

  it("is idempotent and preserves curation on re-import", async () => {
    await importAccreditedPortals();

    const portalRepo = new AccreditedPortalRepo();
    const signalRepo = new AccreditedPortalSignalRepo();

    // Curate: set a CIK on a portal and re-point its seed name signal.
    const portal = (await portalRepo.getPortal("angellist"))!;
    await portalRepo.savePortal({ ...portal, cik: 1608323, notes: "operator CIK" });
    await signalRepo.saveSignal({
      signal_type: "name",
      signal_value: "angellist",
      portal_id: "forge-global",
      source: "manual",
      note: "re-pointed for the test",
      created_at: new Date().toISOString(),
    });

    const before = (await portalRepo.getAllPortals()).length;
    const rerun = await importAccreditedPortals();
    expect((await portalRepo.getAllPortals()).length).toBe(before);
    expect(rerun.signalsSkippedManual).toBe(1);

    const recurated = await portalRepo.getPortal("angellist");
    expect(recurated?.cik).toBe(1608323);
    expect(recurated?.notes).toBe("operator CIK");
    expect((await signalRepo.getSignal("name", "angellist"))?.portal_id).toBe("forge-global");
  });

  it("rejects a malformed seed file", async () => {
    await expect(importAccreditedPortals("/nonexistent/path.json")).rejects.toThrow();
  });
});
