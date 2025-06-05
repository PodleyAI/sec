//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { normalizeCompany } from "./CompanyNormalization";
import { CompanyRepo } from "./CompanyRepo";
import {
  CompaniesAddressJunctionSchema,
  CompaniesEntityJunctionSchema,
  CompanyPhoneJunctionSchema,
  CompanySchema,
  CompanyAddressJunctionPrimaryKeyNames,
  CompanyEntityJunctionPrimaryKeyNames,
  CompanyPhoneJunctionPrimaryKeyNames,
  CompanyPrimaryKeyNames,
} from "./CompanySchema";

describe("CompanyRepo", () => {
  let companyRepo: CompanyRepo;
  let companyStorage: TabularRepository<typeof CompanySchema, typeof CompanyPrimaryKeyNames>;
  let companyJunctionStorage: TabularRepository<
    typeof CompaniesEntityJunctionSchema,
    typeof CompanyEntityJunctionPrimaryKeyNames
  >;
  let companyAddressJunctionStorage: TabularRepository<
    typeof CompaniesAddressJunctionSchema,
    typeof CompanyAddressJunctionPrimaryKeyNames
  >;
  let companyPhoneJunctionStorage: TabularRepository<
    typeof CompanyPhoneJunctionSchema,
    typeof CompanyPhoneJunctionPrimaryKeyNames
  >;

  // Mock data
  const mockCompany1 = "Apple Inc";
  const mockCompany2 = "Microsoft Corporation";
  const mockCompany3 = "Google LLC";

  beforeEach(() => {
    resetDependencyInjectionsForTesting();

    companyRepo = new CompanyRepo();
    companyStorage = companyRepo.companyRepository;
    companyJunctionStorage = companyRepo.companyEntityJunctionRepository;
    companyAddressJunctionStorage = companyRepo.companyAddressJunctionRepository;
    companyPhoneJunctionStorage = companyRepo.companyPhoneJunctionRepository;
  });

  describe("constructor", () => {
    it("should initialize with provided repositories", () => {
      expect(companyRepo.companyRepository).toBe(companyStorage);
      expect(companyRepo.companyEntityJunctionRepository).toBe(companyJunctionStorage);
    });
  });

  describe("getCompany", () => {
    it("should return company when found", async () => {
      const normalizedCompany = normalizeCompany(mockCompany1);
      await companyStorage.put(normalizedCompany!);
      const result = await companyRepo.getCompany(normalizedCompany!.company_hash_id);
      expect(result).toEqual(normalizedCompany!);
    });

    it("should return undefined when company not found", async () => {
      const result = await companyRepo.getCompany("nonexistent_hash");
      expect(result).toBeUndefined();
    });
  });

  describe("saveCompany", () => {
    it("should successfully save company and junction record", async () => {
      const normalizedCompany = normalizeCompany(mockCompany1);
      expect(normalizedCompany).toBeDefined();
      const savedCompany = await companyRepo.saveCompany(mockCompany1);
      await companyRepo.saveRelatedEntity(
        savedCompany.company_hash_id,
        "form-z:something",
        123456,
        ["subsidiary"]
      );

      const storedCompany = await companyStorage.get({
        company_hash_id: normalizedCompany!.company_hash_id,
      });
      expect(storedCompany).toEqual(normalizedCompany!);

      const junctionRecords = await companyJunctionStorage.search({
        company_hash_id: normalizedCompany!.company_hash_id,
        relation_name: "form-z:something",
        cik: 123456,
      });
      expect(junctionRecords).toBeDefined();
      expect(junctionRecords).toHaveLength(1);
      expect(junctionRecords![0]).toEqual({
        company_hash_id: normalizedCompany!.company_hash_id,
        relation_name: "form-z:something",
        cik: 123456,
        titles: ["subsidiary"],
      });
    });

    it("should throw error when normalizeCompany returns undefined", async () => {
      await expect(companyRepo.saveCompany("")).rejects.toThrow(
        "Unable to clean and normalize the provided company:"
      );
    });

    it("should handle different relation names and CIKs", async () => {
      const normalizedCompany = normalizeCompany(mockCompany1);
      expect(normalizedCompany).toBeDefined();
      const savedCompany = await companyRepo.saveCompany(mockCompany1);
      await companyRepo.saveRelatedEntity(
        savedCompany.company_hash_id,
        "form-z:something",
        789456,
        ["parent"]
      );

      const junctionRecord = await companyJunctionStorage.get({
        company_hash_id: normalizedCompany!.company_hash_id,
        relation_name: "form-z:something",
        cik: 789456,
      });
      expect(junctionRecord).toBeDefined();
      expect(junctionRecord).toEqual({
        company_hash_id: normalizedCompany!.company_hash_id,
        relation_name: "form-z:something",
        cik: 789456,
        titles: ["parent"],
      });
    });
  });

  describe("getCompaniesByEntity", () => {
    it("should return companies associated with an entity", async () => {
      const cik = 123456;
      const normalizedCompany = normalizeCompany(mockCompany1);
      expect(normalizedCompany).toBeDefined();
      await companyStorage.put(normalizedCompany!);
      await companyJunctionStorage.put({
        company_hash_id: normalizedCompany!.company_hash_id,
        relation_name: "form-z:something",
        cik: cik,
        titles: ["subsidiary"],
      });

      const result = await companyRepo.getCompaniesByEntity(cik);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(normalizedCompany!);
    });

    it("should return empty array when no companies found for entity", async () => {
      const cik = 999999;
      const result = await companyRepo.getCompaniesByEntity(cik);
      expect(result).toEqual([]);
    });

    it("should return multiple companies for an entity", async () => {
      const cik = 123456;
      const normalizedCompany1 = await companyRepo.saveCompany(mockCompany1);
      await companyRepo.saveRelatedEntity(
        normalizedCompany1.company_hash_id,
        "form-z:something",
        cik,
        ["subsidiary"]
      );
      const normalizedCompany2 = await companyRepo.saveCompany(mockCompany2);
      await companyRepo.saveRelatedEntity(
        normalizedCompany2.company_hash_id,
        "form-z:something",
        cik,
        ["affiliate"]
      );

      const result = await companyRepo.getCompaniesByEntity(cik);
      expect(result).toHaveLength(2);
      expect(result).toContainEqual(normalizedCompany1);
      expect(result).toContainEqual(normalizedCompany2);
    });
  });

  describe("getCompaniesByEntityAndRelation", () => {
    it("should return companies associated with an entity and specific relation", async () => {
      const cik = 123456;
      const relation_type = "form-z:something";
      const normalizedCompany = await companyRepo.saveCompany(mockCompany1);
      await companyRepo.saveRelatedEntity(normalizedCompany.company_hash_id, relation_type, cik, [
        "subsidiary",
      ]);

      // Add another company with different relation
      const normalizedCompany2 = await companyRepo.saveCompany(mockCompany2);
      await companyRepo.saveRelatedEntity(
        normalizedCompany2.company_hash_id,
        "form-d:different",
        cik,
        ["parent"]
      );

      const result = await companyRepo.getCompaniesByEntityAndRelation(cik, relation_type);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(normalizedCompany);
    });

    it("should return empty array when no companies found for entity and relation", async () => {
      const result = await companyRepo.getCompaniesByEntityAndRelation(999999, "nonexistent");
      expect(result).toEqual([]);
    });
  });

  describe("searchCompaniesByName", () => {
    beforeEach(async () => {
      await companyRepo.saveCompany(mockCompany1); // Apple Inc
      await companyRepo.saveCompany(mockCompany2); // Microsoft Corporation
      await companyRepo.saveCompany(mockCompany3); // Google LLC
    });

    it("should search by company name", async () => {
      const result = await companyRepo.searchCompaniesByName("Apple Computer");
      expect(result).toHaveLength(1);
      expect(result[0].company_name).toBe("Apple Computer");
    });

    it("should search by exact normalized name", async () => {
      const result = await companyRepo.searchCompaniesByName("Microsoft");
      expect(result).toHaveLength(1);
      expect(result[0].company_name).toBe("Microsoft");
    });

    it("should return all companies when no search criteria provided", async () => {
      const result = await companyRepo.searchCompaniesByName();
      expect(result).toHaveLength(3);
    });

    it("should return empty array when no matches found", async () => {
      const result = await companyRepo.searchCompaniesByName("Nonexistent Company");
      expect(result).toEqual([]);
    });
  });

  describe("saveRelatedAddress", () => {
    it("should save company-address junction record", async () => {
      const normalizedCompany = normalizeCompany(mockCompany1);
      await companyStorage.put(normalizedCompany!);

      await companyRepo.saveRelatedAddress(
        normalizedCompany!.company_hash_id,
        "form-z:something",
        "address_hash_123"
      );

      const junctionRecord = await companyAddressJunctionStorage.get({
        company_hash_id: normalizedCompany!.company_hash_id,
        relation_name: "form-z:something",
        address_hash_id: "address_hash_123",
      });

      expect(junctionRecord).toBeDefined();
      expect(junctionRecord).toEqual({
        company_hash_id: normalizedCompany!.company_hash_id,
        relation_name: "form-z:something",
        address_hash_id: "address_hash_123",
      });
    });
  });

  describe("saveRelatedPhone", () => {
    it("should save company-phone junction record", async () => {
      const normalizedCompany = normalizeCompany(mockCompany1);
      await companyStorage.put(normalizedCompany!);

      await companyRepo.saveRelatedPhone(
        "+1234567890",
        "form-z:something",
        normalizedCompany!.company_hash_id
      );

      const junctionRecord = await companyPhoneJunctionStorage.get({
        company_hash_id: normalizedCompany!.company_hash_id,
        relation_name: "form-z:something",
        international_number: "+1234567890",
      });

      expect(junctionRecord).toBeDefined();
      expect(junctionRecord).toEqual({
        company_hash_id: normalizedCompany!.company_hash_id,
        relation_name: "form-z:something",
        international_number: "+1234567890",
      });
    });
  });
});
