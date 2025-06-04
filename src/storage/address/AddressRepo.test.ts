//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { InMemoryTabularRepository } from "@podley/storage";
import { AddressRepo, AddressPrimaryKeyNames, AddressJunctionPrimaryKeyNames } from "./AddressRepo";
import type { Address } from "./AddressRepo";
import { normalizeAddress, type AddressImport } from "./AddressNormalization";
import { AddressesEntityJunctionSchema, AddressSchema } from "./AddressSchema";

describe("AddressRepo", () => {
  let addressRepo: AddressRepo;
  let addressStorage: InMemoryTabularRepository<
    typeof AddressSchema,
    typeof AddressPrimaryKeyNames
  >;
  let addressJunctionStorage: InMemoryTabularRepository<
    typeof AddressesEntityJunctionSchema,
    typeof AddressJunctionPrimaryKeyNames
  >;

  const mockAddressImport: AddressImport = {
    street1: "123 Main St",
    city: "New York",
    stateOrCountry: "NY",
    zipCode: "10001",
  };
  const badAddressImport: AddressImport = {
    street1: "123 Main St",
  };
  const mockAddress: Address = normalizeAddress(mockAddressImport)!;

  beforeEach(() => {
    addressStorage = new InMemoryTabularRepository(AddressSchema, AddressPrimaryKeyNames, ["city"]);

    addressJunctionStorage = new InMemoryTabularRepository(
      AddressesEntityJunctionSchema,
      AddressJunctionPrimaryKeyNames,
      ["address_hash_id"]
    );

    // Initialize AddressRepo with real repositories
    addressRepo = new AddressRepo({
      addressRepository: addressStorage,
      addressJunctionRepository: addressJunctionStorage,
    });
  });

  describe("constructor", () => {
    it("should initialize with provided repositories", () => {
      expect(addressRepo.addressRepository).toBe(addressStorage);
      expect(addressRepo.addressJunctionRepository).toBe(addressJunctionStorage);
    });
  });

  describe("getAddress", () => {
    it("should return address when found", async () => {
      await addressStorage.put(mockAddress);
      const result = await addressRepo.getAddress(mockAddress.address_hash_id);
      expect(result).toEqual(mockAddress);
    });

    it("should return undefined when address not found", async () => {
      const addressHashId = "nonexistent_hash";
      const result = await addressRepo.getAddress(addressHashId);
      expect(result).toBeUndefined();
    });
  });

  describe("saveAddress", () => {
    it("should successfully save address and junction record", async () => {
      await addressRepo.saveAddress(mockAddressImport, "business|address", 123456);

      const storedAddress = await addressStorage.get({
        address_hash_id: mockAddress.address_hash_id,
      });
      expect(storedAddress).toEqual(mockAddress);

      const junctionRecords = await addressJunctionStorage.search({
        address_hash_id: mockAddress.address_hash_id,
        relation_name: "business|address",
        cik: 123456,
      });
      expect(junctionRecords).toBeDefined();
      expect(junctionRecords).toHaveLength(1);
      expect(junctionRecords![0]).toEqual({
        address_hash_id: mockAddress.address_hash_id,
        relation_name: "business|address",
        cik: 123456,
      });
    });

    it("should throw error when normalizeAddress returns null", async () => {
      expect(addressRepo.saveAddress(badAddressImport, "business|address", 123456)).rejects.toThrow(
        "Unable to clean and normalize the provided address"
      );

      const allAddresses = await addressStorage.getAll();
      const allJunctions = await addressJunctionStorage.getAll();
      expect(allAddresses || []).toEqual([]);
      expect(allJunctions || []).toEqual([]);
    });

    it("should throw error when cleanAddress returns undefined", async () => {
      expect(addressRepo.saveAddress(badAddressImport, "business|address", 123456)).rejects.toThrow(
        "Unable to clean and normalize the provided address"
      );

      const allAddresses = await addressStorage.getAll();
      const allJunctions = await addressJunctionStorage.getAll();
      expect(allAddresses || []).toEqual([]);
      expect(allJunctions || []).toEqual([]);
    });

    it("should handle different relation names and CIKs", async () => {
      await addressRepo.saveAddress(mockAddressImport, "mailing|address", 789456);

      const junctionRecord = await addressJunctionStorage.get({
        address_hash_id: mockAddress.address_hash_id,
        relation_name: "mailing|address",
        cik: 789456,
      });
      expect(junctionRecord).toBeDefined();
      expect(junctionRecord).toEqual({
        address_hash_id: mockAddress.address_hash_id,
        relation_name: "mailing|address",
        cik: 789456,
      });
    });

    it("should call both repository put methods", async () => {
      await addressRepo.saveAddress(mockAddressImport, "business|address", 123456);

      const storedAddress = await addressStorage.get({
        address_hash_id: mockAddress.address_hash_id,
      });
      expect(storedAddress).toEqual(mockAddress);

      const junctionRecords = await addressJunctionStorage.search({
        address_hash_id: mockAddress.address_hash_id,
      });
      expect(junctionRecords).toBeDefined();
      expect(junctionRecords).toHaveLength(1);
    });

    it("should handle empty string relation name", async () => {
      await addressRepo.saveAddress(mockAddressImport, "", 123456);

      const junctionRecord = await addressJunctionStorage.get({
        address_hash_id: mockAddress.address_hash_id,
        relation_name: "",
        cik: 123456,
      });
      expect(junctionRecord).not.toBeDefined();
    });

    it("should handle multiple addresses with same hash_id but different relations", async () => {
      await addressRepo.saveAddress(mockAddressImport, "business|address", 123456);
      await addressRepo.saveAddress(mockAddressImport, "mailing|address", 123456);

      const storedAddress = await addressStorage.get({
        address_hash_id: mockAddress.address_hash_id,
      });
      expect(storedAddress).toEqual(mockAddress);

      const allJunctionRecords = await addressJunctionStorage.search({
        address_hash_id: mockAddress.address_hash_id,
      });
      expect(allJunctionRecords).toBeDefined();
      expect(allJunctionRecords).toHaveLength(2);

      const relationNames = allJunctionRecords!.map((r) => r.relation_name).sort();
      expect(relationNames).toEqual(["business|address", "mailing|address"]);
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete workflow: save then retrieve address", async () => {
      await addressRepo.saveAddress(mockAddressImport, "business|address", 123456);

      const retrievedAddress = await addressRepo.getAddress(mockAddress.address_hash_id);

      expect(retrievedAddress).toEqual(mockAddress);

      const junctionRecords = await addressJunctionStorage.search({
        address_hash_id: mockAddress.address_hash_id,
      });
      expect(junctionRecords).toBeDefined();
      expect(junctionRecords).toHaveLength(1);
    });

    it("should handle malformed address import data", async () => {
      const malformedImport: AddressImport = {
        city: null,
        stateOrCountry: null,
        street1: "",
        zipCode: "invalid",
      };

      expect(addressRepo.saveAddress(malformedImport, "business|address", 123456)).rejects.toThrow(
        "Unable to clean and normalize the provided address"
      );

      const allAddresses = await addressStorage.getAll();
      const allJunctions = await addressJunctionStorage.getAll();
      expect(allAddresses || []).toEqual([]);
      expect(allJunctions || []).toEqual([]);
    });

    it("should allow searching for addresses by various criteria", async () => {
      const address1 = { ...mockAddress, city: "NEW YORK" };
      const address2 = { ...mockAddress, city: "BOSTON" };

      await addressRepo.saveAddress(mockAddressImport, "business|address", 123456);
      await addressRepo.saveAddress(mockAddressImport, "business|address", 789012);

      const nyAddresses = await addressStorage.search({ city: "NEW YORK" });

      expect(nyAddresses).toBeDefined();
      expect(nyAddresses).toHaveLength(1);
      expect(nyAddresses![0].address_hash_id).toBe("123 main st|new york|ny|us|10001");
    });
  });
});
