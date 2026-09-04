/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import { normalizeAddress, type AddressImport } from "./AddressNormalization";
import { AddressRepo } from "./AddressRepo";
import type { Address } from "./AddressSchema";
import {
  AddressesEntityJunction,
  AddressesEntityJunctionSchema,
  AddressJunctionPrimaryKeyNames,
  AddressPrimaryKeyNames,
  AddressSchema,
} from "./AddressSchema";

describe("AddressRepo", () => {
  let addressRepo: AddressRepo;
  let addressStorage: InMemoryTabularStorage<
    typeof AddressSchema,
    typeof AddressPrimaryKeyNames,
    Address
  >;
  let addressJunctionStorage: InMemoryTabularStorage<
    typeof AddressesEntityJunctionSchema,
    typeof AddressJunctionPrimaryKeyNames,
    AddressesEntityJunction
  >;

  const mockAddressImport: Readonly<AddressImport> = {
    street1: "123 Main St",
    city: "New York",
    stateOrCountry: "NY",
    zipCode: "10001",
  } as const;
  const badAddressImport: AddressImport = {
    street1: "123 Main St",
  };
  const mockAddress: Address = normalizeAddress(mockAddressImport)!;

  beforeEach(() => {
    addressStorage = new InMemoryTabularStorage<
      typeof AddressSchema,
      typeof AddressPrimaryKeyNames,
      Address
    >(AddressSchema, AddressPrimaryKeyNames, ["city"]);

    addressJunctionStorage = new InMemoryTabularStorage(
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
      await addressRepo.saveAddress(mockAddressImport);
      await addressRepo.saveRelatedEntity(mockAddress.address_hash_id, "business|address", 123456);

      const storedAddress = await addressStorage.get({
        address_hash_id: mockAddress.address_hash_id,
      });
      expect(storedAddress).toEqual(mockAddress);

      const junctionRecords = await addressJunctionStorage.query({
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
      await expect(addressRepo.saveAddress(badAddressImport)).rejects.toThrow(
        "Unable to clean and normalize the provided address"
      );

      const allAddresses = await addressStorage.getAll();
      const allJunctions = await addressJunctionStorage.getAll();
      expect(allAddresses || []).toEqual([]);
      expect(allJunctions || []).toEqual([]);
    });

    it("returns undefined from saveAddressIfUsable instead of throwing", async () => {
      // EDGAR ships address objects with every field blank. Callers for whom the
      // address is one detail among many must be able to skip it without losing
      // the enclosing record — see StoreSubmissionContactInfoTask.
      await expect(addressRepo.saveAddressIfUsable(badAddressImport)).resolves.toBeUndefined();

      const allAddresses = await addressStorage.getAll();
      const allJunctions = await addressJunctionStorage.getAll();
      expect(allAddresses || []).toEqual([]);
      expect(allJunctions || []).toEqual([]);
    });

    it("saveAddressIfUsable still persists a usable address", async () => {
      const saved = await addressRepo.saveAddressIfUsable(mockAddressImport);
      expect(saved).toEqual(mockAddress);

      const storedAddress = await addressStorage.get({
        address_hash_id: mockAddress.address_hash_id,
      });
      expect(storedAddress).toEqual(mockAddress);
    });

    it("should throw error when cleanAddress returns undefined", async () => {
      await expect(addressRepo.saveAddress(badAddressImport)).rejects.toThrow(
        "Unable to clean and normalize the provided address"
      );

      const allAddresses = await addressStorage.getAll();
      const allJunctions = await addressJunctionStorage.getAll();
      expect(allAddresses || []).toEqual([]);
      expect(allJunctions || []).toEqual([]);
    });

    it("should handle different relation names and CIKs", async () => {
      await addressRepo.saveAddress(mockAddressImport);
      await addressRepo.saveRelatedEntity(mockAddress.address_hash_id, "mailing|address", 789456);

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
      await addressRepo.saveAddress(mockAddressImport);
      await addressRepo.saveRelatedEntity(mockAddress.address_hash_id, "business|address", 123456);

      const storedAddress = await addressStorage.get({
        address_hash_id: mockAddress.address_hash_id,
      });
      expect(storedAddress).toEqual(mockAddress);

      const junctionRecords = await addressJunctionStorage.query({
        address_hash_id: mockAddress.address_hash_id,
      });
      expect(junctionRecords).toBeDefined();
      expect(junctionRecords).toHaveLength(1);
    });

    it("should handle empty string relation name", async () => {
      await addressRepo.saveAddress(mockAddressImport);
      await addressRepo.saveRelatedEntity(mockAddress.address_hash_id, "", 123456);

      const junctionRecord = await addressJunctionStorage.get({
        address_hash_id: mockAddress.address_hash_id,
        relation_name: "",
        cik: 123456,
      });
      expect(junctionRecord).toBeDefined();
    });

    it("should handle multiple addresses with same hash_id but different relations", async () => {
      await addressRepo.saveAddress(mockAddressImport);
      await addressRepo.saveRelatedEntity(mockAddress.address_hash_id, "business|address", 123456);
      await addressRepo.saveAddress(mockAddressImport);
      await addressRepo.saveRelatedEntity(mockAddress.address_hash_id, "mailing|address", 123456);

      const storedAddress = await addressStorage.get({
        address_hash_id: mockAddress.address_hash_id,
      });
      expect(storedAddress).toEqual(mockAddress);

      const allJunctionRecords = await addressJunctionStorage.query({
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
      await addressRepo.saveAddress(mockAddressImport);
      await addressRepo.saveRelatedEntity(mockAddress.address_hash_id, "business|address", 123456);

      const retrievedAddress = await addressRepo.getAddress(mockAddress.address_hash_id);

      expect(retrievedAddress).toEqual(mockAddress);

      const junctionRecords = await addressJunctionStorage.query({
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

      await expect(addressRepo.saveAddress(malformedImport)).rejects.toThrow(
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

      await addressRepo.saveAddress(mockAddressImport);
      await addressRepo.saveRelatedEntity(mockAddress.address_hash_id, "business|address", 123456);
      await addressRepo.saveAddress(mockAddressImport);
      await addressRepo.saveRelatedEntity(mockAddress.address_hash_id, "business|address", 789012);

      const nyAddresses = await addressStorage.query({ city: "NEW YORK" });

      expect(nyAddresses).toBeDefined();
      expect(nyAddresses).toHaveLength(1);
      expect(nyAddresses![0].address_hash_id).toBe("123 main st|new york|ny|us|10001");
    });
  });
});
