//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { IssuerRepo } from "./IssuerRepo";
import { type Issuer, type IssuerRepositoryStorage } from "./IssuerSchema";

describe("IssuerRepo", () => {
  let issuerRepo: IssuerRepo;
  let issuerStorage: IssuerRepositoryStorage;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    issuerRepo = new IssuerRepo();
    issuerStorage = issuerRepo.issuerRepository;
  });

  const mockIssuer: Issuer = {
    cik: 123456,
    issuer_cik: 789012,
    is_primary: true,
  };

  describe("getIssuer", () => {
    it("should retrieve an issuer relationship by cik and issuer_cik", async () => {
      await issuerStorage.put(mockIssuer);

      const result = await issuerRepo.getIssuer(123456, 789012);

      expect(result).toEqual(mockIssuer);
    });

    it("should return undefined if issuer relationship not found", async () => {
      const result = await issuerRepo.getIssuer(999999, 888888);

      expect(result).toBeUndefined();
    });
  });

  describe("saveIssuer", () => {
    it("should save an issuer relationship", async () => {
      const result = await issuerRepo.saveIssuer(mockIssuer);

      expect(result).toEqual(mockIssuer);

      // Verify it was actually saved
      const savedIssuer = await issuerStorage.get({
        cik: mockIssuer.cik,
        issuer_cik: mockIssuer.issuer_cik,
      });
      expect(savedIssuer).toEqual(mockIssuer);
    });

    it("should update an existing issuer relationship", async () => {
      // First save the issuer
      await issuerRepo.saveIssuer(mockIssuer);

      // Create an updated version
      const updatedIssuer: Issuer = {
        ...mockIssuer,
        is_primary: false,
      };

      const result = await issuerRepo.saveIssuer(updatedIssuer);

      expect(result).toEqual(updatedIssuer);

      // Verify the update
      const savedIssuer = await issuerStorage.get({
        cik: mockIssuer.cik,
        issuer_cik: mockIssuer.issuer_cik,
      });
      expect(savedIssuer).toEqual(updatedIssuer);
    });
  });

  describe("getIssuersByCik", () => {
    it("should return empty array if no issuers found for cik", async () => {
      const result = await issuerRepo.getIssuersByCik(999999);

      expect(result).toEqual([]);
    });

    it("should return issuers associated with a cik", async () => {
      const issuer1 = { ...mockIssuer };
      const issuer2 = { ...mockIssuer, issuer_cik: 888888, is_primary: false };

      await issuerStorage.put(issuer1);
      await issuerStorage.put(issuer2);

      const result = await issuerRepo.getIssuersByCik(123456);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(issuer1);
      expect(result).toContainEqual(issuer2);
    });
  });

  describe("getEntitiesByIssuerCik", () => {
    it("should retrieve entities by issuer cik", async () => {
      const issuer1 = { ...mockIssuer };
      const issuer2 = { ...mockIssuer, cik: 555555 };

      await issuerStorage.put(issuer1);
      await issuerStorage.put(issuer2);

      const result = await issuerRepo.getEntitiesByIssuerCik(789012);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(issuer1);
      expect(result).toContainEqual(issuer2);
    });
  });

  describe("getPrimaryIssuersByCik", () => {
    it("should retrieve only primary issuers for a cik", async () => {
      const primaryIssuer = { ...mockIssuer, is_primary: true };
      const secondaryIssuer = { ...mockIssuer, issuer_cik: 888888, is_primary: false };

      await issuerStorage.put(primaryIssuer);
      await issuerStorage.put(secondaryIssuer);

      const result = await issuerRepo.getPrimaryIssuersByCik(123456);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(primaryIssuer);
    });
  });

  describe("getEntitiesWithPrimaryIssuer", () => {
    it("should retrieve entities where the issuer is primary", async () => {
      const primaryRelation = { ...mockIssuer, is_primary: true };
      const secondaryRelation = { ...mockIssuer, cik: 555555, is_primary: false };

      await issuerStorage.put(primaryRelation);
      await issuerStorage.put(secondaryRelation);

      const result = await issuerRepo.getEntitiesWithPrimaryIssuer(789012);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(primaryRelation);
    });
  });

  describe("getSecondaryIssuersByCik", () => {
    it("should retrieve only secondary issuers for a cik", async () => {
      const primaryIssuer = { ...mockIssuer, is_primary: true };
      const secondaryIssuer = { ...mockIssuer, issuer_cik: 888888, is_primary: false };

      await issuerStorage.put(primaryIssuer);
      await issuerStorage.put(secondaryIssuer);

      const result = await issuerRepo.getSecondaryIssuersByCik(123456);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(secondaryIssuer);
    });
  });

  describe("getEntitiesWithSecondaryIssuer", () => {
    it("should retrieve entities where the issuer is secondary", async () => {
      const primaryRelation = { ...mockIssuer, is_primary: true };
      const secondaryRelation = { ...mockIssuer, cik: 555555, is_primary: false };

      await issuerStorage.put(primaryRelation);
      await issuerStorage.put(secondaryRelation);

      const result = await issuerRepo.getEntitiesWithSecondaryIssuer(789012);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(secondaryRelation);
    });
  });

  describe("hasIssuerRelationship", () => {
    it("should return true if relationship exists", async () => {
      await issuerStorage.put(mockIssuer);

      const result = await issuerRepo.hasIssuerRelationship(123456, 789012);

      expect(result).toBe(true);
    });

    it("should return false if relationship does not exist", async () => {
      const result = await issuerRepo.hasIssuerRelationship(999999, 888888);

      expect(result).toBe(false);
    });
  });

  describe("hasPrimaryIssuerRelationship", () => {
    it("should return true if primary relationship exists", async () => {
      await issuerStorage.put({ ...mockIssuer, is_primary: true });

      const result = await issuerRepo.hasPrimaryIssuerRelationship(123456, 789012);

      expect(result).toBe(true);
    });

    it("should return false if only secondary relationship exists", async () => {
      await issuerStorage.put({ ...mockIssuer, is_primary: false });

      const result = await issuerRepo.hasPrimaryIssuerRelationship(123456, 789012);

      expect(result).toBe(false);
    });

    it("should return false if no relationship exists", async () => {
      const result = await issuerRepo.hasPrimaryIssuerRelationship(999999, 888888);

      expect(result).toBe(false);
    });
  });

  describe("removeIssuer", () => {
    it("should remove an existing issuer relationship", async () => {
      await issuerStorage.put(mockIssuer);

      const result = await issuerRepo.removeIssuer(123456, 789012);

      expect(result).toBe(true);

      // Verify it was removed
      const deletedIssuer = await issuerStorage.get({
        cik: mockIssuer.cik,
        issuer_cik: mockIssuer.issuer_cik,
      });
      expect(deletedIssuer).toBeUndefined();
    });

    it("should return false when trying to remove non-existent relationship", async () => {
      const result = await issuerRepo.removeIssuer(999999, 888888);

      expect(result).toBe(false);
    });
  });

  describe("updateIssuerPrimaryStatus", () => {
    it("should update the primary status of an existing relationship", async () => {
      await issuerStorage.put({ ...mockIssuer, is_primary: false });

      const result = await issuerRepo.updateIssuerPrimaryStatus(123456, 789012, true);

      expect(result).toEqual({ ...mockIssuer, is_primary: true });

      // Verify the update
      const updatedIssuer = await issuerStorage.get({
        cik: mockIssuer.cik,
        issuer_cik: mockIssuer.issuer_cik,
      });
      expect(updatedIssuer?.is_primary).toBe(true);
    });

    it("should return undefined for non-existent relationship", async () => {
      const result = await issuerRepo.updateIssuerPrimaryStatus(999999, 888888, true);

      expect(result).toBeUndefined();
    });
  });

  describe("searchIssuers", () => {
    it("should return all issuers when no search criteria provided", async () => {
      await issuerStorage.put(mockIssuer);
      const issuer2 = { ...mockIssuer, cik: 555555 };
      await issuerStorage.put(issuer2);

      const result = await issuerRepo.searchIssuers({});

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(mockIssuer);
      expect(result).toContainEqual(issuer2);
    });

    it("should search by multiple criteria", async () => {
      const issuer1 = { ...mockIssuer, is_primary: true };
      const issuer2 = { ...mockIssuer, cik: 555555, is_primary: false };

      await issuerStorage.put(issuer1);
      await issuerStorage.put(issuer2);

      const result = await issuerRepo.searchIssuers({
        issuer_cik: 789012,
        is_primary: true,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(issuer1);
    });
  });

  describe("getAllIssuers", () => {
    it("should return empty array when no issuers exist", async () => {
      const result = await issuerRepo.getAllIssuers();

      expect(result).toEqual([]);
    });

    it("should return all issuer relationships", async () => {
      const issuer1 = { ...mockIssuer };
      const issuer2 = { ...mockIssuer, cik: 555555 };

      await issuerStorage.put(issuer1);
      await issuerStorage.put(issuer2);

      const result = await issuerRepo.getAllIssuers();

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(issuer1);
      expect(result).toContainEqual(issuer2);
    });
  });
});
