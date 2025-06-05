//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { PortalRepo } from "./PortalRepo";
import { Portal, PortalRepositoryStorage } from "./PortalSchema";

describe("PortalRepo", () => {
  let portalRepo: PortalRepo;
  let portalStorage: PortalRepositoryStorage;

  // Mock data
  const mockPortal1: Portal = {
    cik: 1234567,
    name: "StartEngine Capital, LLC",
    brand: "StartEngine",
    url: "https://www.startengine.com",
    live: true,
  };

  const mockPortal2: Portal = {
    cik: 7654321,
    name: "Republic Crowd Funding Inc.",
    brand: "Republic",
    url: "https://republic.co",
    live: true,
  };

  const mockPortal3: Portal = {
    cik: 9999999,
    name: "Inactive Portal LLC",
    brand: "InactivePortal",
    url: "https://inactive.example.com",
    live: false,
  };

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    portalRepo = new PortalRepo();
    portalStorage = portalRepo.portalRepository;
  });

  describe("getPortal", () => {
    it("should return portal when found", async () => {
      await portalStorage.put(mockPortal1);
      const result = await portalRepo.getPortal(mockPortal1.cik);
      expect(result).toEqual(mockPortal1);
    });

    it("should return undefined when portal not found", async () => {
      const result = await portalRepo.getPortal(9876543);
      expect(result).toBeUndefined();
    });
  });

  describe("savePortal", () => {
    it("should successfully save a portal", async () => {
      const savedPortal = await portalRepo.savePortal(mockPortal1);
      expect(savedPortal).toEqual(mockPortal1);

      const storedPortal = await portalStorage.get({ cik: mockPortal1.cik });
      expect(storedPortal).toEqual(mockPortal1);
    });

    it("should update existing portal", async () => {
      await portalStorage.put(mockPortal1);

      const updatedPortal = { ...mockPortal1, name: "Updated Portal Name" };
      const savedPortal = await portalRepo.savePortal(updatedPortal);

      expect(savedPortal).toEqual(updatedPortal);
      const storedPortal = await portalStorage.get({ cik: mockPortal1.cik });
      expect(storedPortal).toEqual(updatedPortal);
    });
  });

  describe("deletePortal", () => {
    it("should successfully delete a portal", async () => {
      await portalStorage.put(mockPortal1);

      await portalRepo.deletePortal(mockPortal1.cik);

      const result = await portalStorage.get({ cik: mockPortal1.cik });
      expect(result).toBeUndefined();
    });

    it("should not throw error when deleting non-existent portal", async () => {
      await expect(portalRepo.deletePortal(9876543)).resolves.toBeUndefined();
    });
  });

  describe("getAllPortals", () => {
    it("should return all portals", async () => {
      await portalStorage.put(mockPortal1);
      await portalStorage.put(mockPortal2);
      await portalStorage.put(mockPortal3);

      const result = await portalRepo.getAllPortals();
      expect(result).toHaveLength(3);
      expect(result).toContainEqual(mockPortal1);
      expect(result).toContainEqual(mockPortal2);
      expect(result).toContainEqual(mockPortal3);
    });

    it("should return empty array when no portals exist", async () => {
      const result = await portalRepo.getAllPortals();
      expect(result).toEqual([]);
    });
  });

  describe("getActivePortals", () => {
    it("should return only active portals", async () => {
      await portalStorage.put(mockPortal1);
      await portalStorage.put(mockPortal2);
      await portalStorage.put(mockPortal3);

      const result = await portalRepo.getActivePortals();
      expect(result).toHaveLength(2);
      expect(result).toContainEqual(mockPortal1);
      expect(result).toContainEqual(mockPortal2);
      expect(result).not.toContainEqual(mockPortal3);
    });

    it("should return empty array when no active portals exist", async () => {
      await portalStorage.put(mockPortal3); // inactive portal

      const result = await portalRepo.getActivePortals();
      expect(result).toEqual([]);
    });
  });

  describe("getPortalsByBrand", () => {
    it("should return portals with matching brand", async () => {
      await portalStorage.put(mockPortal1);
      await portalStorage.put(mockPortal2);

      const result = await portalRepo.getPortalsByBrand("StartEngine");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockPortal1);
    });

    it("should return empty array when no portals match brand", async () => {
      await portalStorage.put(mockPortal1);

      const result = await portalRepo.getPortalsByBrand("NonExistentBrand");
      expect(result).toEqual([]);
    });
  });

  describe("searchPortalsByName", () => {
    it("should return portals with matching name", async () => {
      await portalStorage.put(mockPortal1);
      await portalStorage.put(mockPortal2);

      const result = await portalRepo.searchPortalsByName("StartEngine Capital, LLC");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockPortal1);
    });

    it("should return empty array when no portals match name", async () => {
      await portalStorage.put(mockPortal1);

      const result = await portalRepo.searchPortalsByName("NonExistent Portal");
      expect(result).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("should handle portal with minimal data", async () => {
      const minimalPortal: Portal = {
        cik: 1111111,
        name: null,
        brand: null,
        url: null,
        live: null,
      };

      const savedPortal = await portalRepo.savePortal(minimalPortal);
      expect(savedPortal).toEqual(minimalPortal);

      const result = await portalRepo.getPortal(1111111);
      expect(result).toEqual(minimalPortal);
    });

    it("should handle portal with only required cik field", async () => {
      const cikOnlyPortal: Portal = {
        cik: 2222222,
      };

      const savedPortal = await portalRepo.savePortal(cikOnlyPortal);
      expect(savedPortal).toEqual(cikOnlyPortal);

      const result = await portalRepo.getPortal(2222222);
      expect(result).toEqual(cikOnlyPortal);
    });
  });
});
