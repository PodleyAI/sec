/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { AccreditedPortalRepo } from "./AccreditedPortalRepo";
import { slugifyPortalId } from "./AccreditedPortalSchema";

describe("slugifyPortalId", () => {
  it("derives stable slugs from display names", () => {
    expect(slugifyPortalId("AngelList")).toBe("angellist");
    expect(slugifyPortalId("Forge Global")).toBe("forge-global");
    expect(slugifyPortalId("Nasdaq Private Market")).toBe("nasdaq-private-market");
  });
});

describe("AccreditedPortalRepo", () => {
  let repo: AccreditedPortalRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = new AccreditedPortalRepo();
  });

  it("saves and fetches a portal by id, and finds it by name", async () => {
    await repo.savePortal({
      portal_id: "angellist",
      name: "AngelList",
      brand: null,
      url: "https://www.angellist.com/",
      live: true,
      cik: null,
      notes: null,
    });
    expect((await repo.getPortal("angellist"))?.name).toBe("AngelList");
    expect((await repo.findPortal("AngelList"))?.portal_id).toBe("angellist");
    expect(await repo.findPortal("nope")).toBeUndefined();
  });

  it("upsertFromSeed preserves curated cik/notes across re-imports", async () => {
    await repo.upsertFromSeed({
      portal_id: "forge-global",
      name: "Forge Global",
      brand: null,
      url: "https://forgeglobal.com/",
      live: true,
    });
    await repo.savePortal({
      ...(await repo.getPortal("forge-global"))!,
      cik: 1827821,
      notes: "curated",
    });

    await repo.upsertFromSeed({
      portal_id: "forge-global",
      name: "Forge Global",
      brand: null,
      url: "https://forgeglobal.com/new",
      live: false,
    });

    const portal = await repo.getPortal("forge-global");
    expect(portal?.url).toBe("https://forgeglobal.com/new");
    expect(portal?.live).toBe(false);
    expect(portal?.cik).toBe(1827821);
    expect(portal?.notes).toBe("curated");
  });

  it("filters live portals", async () => {
    await repo.savePortal({
      portal_id: "a",
      name: "A",
      brand: null,
      url: null,
      live: true,
      cik: null,
      notes: null,
    });
    await repo.savePortal({
      portal_id: "b",
      name: "B",
      brand: null,
      url: null,
      live: false,
      cik: null,
      notes: null,
    });
    const live = await repo.getLivePortals();
    expect(live.map((p) => p.portal_id)).toEqual(["a"]);
  });
});
