//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryTabularRepository } from "@podley/storage";
import { beforeEach, describe, expect, it } from "bun:test";
import { PhoneImport } from "./PhoneNormalization";
import {
  Phone,
  PhoneEntityJunctionPrimaryKeyNames,
  PhonePrimaryKeyNames,
  PhoneRepo,
  type PhoneEntityJunctionRepositoryStorage,
  type PhoneRepositoryStorage,
} from "./PhoneRepo";
import { PhoneSchema, PhonesEntityJunctionSchema } from "./PhoneSchema";

describe("PhoneRepo", () => {
  let phoneRepo: PhoneRepo;
  let phoneStorage: PhoneRepositoryStorage;
  let phoneEntityJunctionStorage: PhoneEntityJunctionRepositoryStorage;

  beforeEach(() => {
    // Create real in-memory repositories with appropriate indexes
    phoneStorage = new InMemoryTabularRepository(
      PhoneSchema,
      PhonePrimaryKeyNames,
      ["international_number", "country_code"] // Add indexes for searching
    );

    phoneEntityJunctionStorage = new InMemoryTabularRepository(
      PhonesEntityJunctionSchema,
      PhoneEntityJunctionPrimaryKeyNames,
      [["relation_name"], ["cik"], ["international_number"]] // Add indexes for searching
    );

    phoneRepo = new PhoneRepo({
      phoneRepository: phoneStorage,
      phoneEntityJunctionRepository: phoneEntityJunctionStorage,
    });
  });

  describe("getPhone", () => {
    it("should retrieve a phone by international number", async () => {
      const mockPhone: Phone = {
        international_number: "+1 555-123-4567",
        country_code: "US",
        type: "mobile",
        raw_phone: "555-123-4567",
      };

      await phoneStorage.put(mockPhone);

      const result = await phoneRepo.getPhone("+1 555-123-4567");

      expect(result).toEqual(mockPhone);
    });

    it("should return undefined if phone not found", async () => {
      const result = await phoneRepo.getPhone("nonexistent");

      expect(result).toBeUndefined();
    });
  });

  describe("savePhone", () => {
    it("should save a normalized phone", async () => {
      const phoneImport: PhoneImport = {
        phone_raw: "555-123-4567",
      };

      const result = await phoneRepo.savePhone(phoneImport);

      expect(result).toBeDefined();
      expect(result.country_code).toBe("US");
      expect(result.international_number).toBe("+1 555-123-4567");
      expect(result.type).toBe("unknown");

      // Verify it was actually saved
      const savedPhone = await phoneStorage.get({
        international_number: result.international_number,
      });
      expect(savedPhone).toEqual(result);
    });

    it("should throw error for invalid phone", async () => {
      const phoneImport: PhoneImport = {
        phone_raw: "invalid",
      };

      await expect(phoneRepo.savePhone(phoneImport)).rejects.toThrow(
        "Unable to clean and normalize the provided phone"
      );
    });
  });

  describe("saveRelatedEntity", () => {
    it("should save phone-entity junction", async () => {
      await phoneRepo.saveRelatedEntity("+1 555-123-4567", "test-relation", 123456);

      const junction = await phoneEntityJunctionStorage.get({
        international_number: "+1 555-123-4567",
        relation_name: "test-relation",
        cik: 123456,
      });

      expect(junction).toEqual({
        international_number: "+1 555-123-4567",
        relation_name: "test-relation",
        cik: 123456,
      });
    });
  });

  describe("savePhoneRelatedEntity", () => {
    it("should save phone and create entity relation", async () => {
      const phoneImport: PhoneImport = {
        phone_raw: "555-123-4567",
        country_code: "US",
      };

      const result = await phoneRepo.savePhoneRelatedEntity(phoneImport, "test-relation", 123456);

      // Verify phone was saved
      const savedPhone = await phoneStorage.get({
        international_number: result.international_number,
      });
      expect(savedPhone).toEqual(result);

      // Verify junction was created
      const junction = await phoneEntityJunctionStorage.get({
        international_number: result.international_number,
        relation_name: "test-relation",
        cik: 123456,
      });
      expect(junction).toEqual({
        international_number: result.international_number,
        relation_name: "test-relation",
        cik: 123456,
      });
    });
  });

  describe("getPhonesByEntity", () => {
    it("should return empty array if no junctions found", async () => {
      const result = await phoneRepo.getPhonesByEntity(123456);

      expect(result).toEqual([]);
    });

    it("should return phones associated with an entity", async () => {
      const phone: Phone = {
        international_number: "+1 555-123-4567",
        country_code: "US",
        type: "mobile",
        raw_phone: "555-123-4567",
      };

      // Save phone and junction
      await phoneStorage.put(phone);
      await phoneEntityJunctionStorage.put({
        international_number: phone.international_number,
        relation_name: "test-relation",
        cik: 123456,
      });

      const result = await phoneRepo.getPhonesByEntity(123456);

      expect(result).toEqual([phone]);
    });
  });

  describe("getPhonesByEntityAndRelation", () => {
    it("should retrieve phones by entity and relation", async () => {
      const phone: Phone = {
        international_number: "+1 555-123-4567",
        country_code: "US",
        type: "mobile",
        raw_phone: "555-123-4567",
      };

      // Save phone and junction
      await phoneStorage.put(phone);
      await phoneEntityJunctionStorage.put({
        international_number: phone.international_number,
        relation_name: "test-relation",
        cik: 123456,
      });

      const result = await phoneRepo.getPhonesByEntityAndRelation(123456, "test-relation");

      expect(result).toEqual([phone]);
    });
  });

  describe("searchPhonesByInternationalNumber", () => {
    it("should search phones by international number", async () => {
      const phone: Phone = {
        international_number: "+1 555-123-4567",
        country_code: "US",
        type: "mobile",
        raw_phone: "555-123-4567",
      };

      await phoneStorage.put(phone);

      const result = await phoneRepo.searchPhonesByInternationalNumber("+1 555-123-4567");

      expect(result).toEqual([phone]);
    });

    it("should return all phones when no search criteria provided", async () => {
      const phone: Phone = {
        international_number: "+1 555-123-4567",
        country_code: "US",
        type: "mobile",
        raw_phone: "555-123-4567",
      };

      await phoneStorage.put(phone);

      const result = await phoneRepo.searchPhonesByInternationalNumber();

      expect(result).toEqual([phone]);
    });
  });
});
