//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  AddressesEntityHistoryJunctionSchema,
  type AddressesEntityHistoryJunction,
} from "./AddressHistorySchema";

describe("AddressHistorySchema", () => {
  describe("AddressesEntityHistoryJunctionSchema", () => {
    it("should validate a valid address history junction", () => {
      const validJunction: AddressesEntityHistoryJunction = {
        relation_name: "business",
        cik: 1234567,
        address_hash_id: "hash123",
        valid_from: "2024-01-01T00:00:00Z",
        valid_to: null,
        change_source: "10-K",
        change_date: "2024-01-01T00:00:00Z",
      };

      const isValid = Value.Check(AddressesEntityHistoryJunctionSchema, validJunction);
      expect(isValid).toBe(true);
    });

    it("should validate junction with valid_to date", () => {
      const junctionWithEnd: AddressesEntityHistoryJunction = {
        relation_name: "mailing",
        cik: 9876543,
        address_hash_id: "hash456",
        valid_from: "2023-01-01T00:00:00Z",
        valid_to: "2024-01-01T00:00:00Z",
        change_source: "8-K",
        change_date: "2023-01-01T00:00:00Z",
      };

      const isValid = Value.Check(AddressesEntityHistoryJunctionSchema, junctionWithEnd);
      expect(isValid).toBe(true);
    });

    it("should reject junction with missing required fields", () => {
      const invalidJunction = {
        relation_name: "business",
        cik: 1234567,
        // missing address_hash_id
        valid_from: "2024-01-01T00:00:00Z",
        valid_to: null,
        change_source: "10-K",
        change_date: "2024-01-01T00:00:00Z",
      };

      const isValid = Value.Check(AddressesEntityHistoryJunctionSchema, invalidJunction);
      expect(isValid).toBe(false);
    });

    it("should reject junction with invalid CIK", () => {
      const invalidJunction = {
        relation_name: "business",
        cik: -1, // negative CIK
        address_hash_id: "hash123",
        valid_from: "2024-01-01T00:00:00Z",
        valid_to: null,
        change_source: "10-K",
        change_date: "2024-01-01T00:00:00Z",
      };

      const isValid = Value.Check(AddressesEntityHistoryJunctionSchema, invalidJunction);
      expect(isValid).toBe(false);
    });

    it("should handle different change sources", () => {
      const sources = ["10-K", "8-K", "10-Q", "SUBMISSION_UPDATE", "DAILY_INDEX"];

      sources.forEach((source) => {
        const junction: AddressesEntityHistoryJunction = {
          relation_name: "headquarters",
          cik: 1234567,
          address_hash_id: "hash789",
          valid_from: "2024-01-01T00:00:00Z",
          valid_to: null,
          change_source: source,
          change_date: "2024-01-01T00:00:00Z",
        };

        const isValid = Value.Check(AddressesEntityHistoryJunctionSchema, junction);
        expect(isValid).toBe(true);
      });
    });

    it("should validate different relation names", () => {
      const relationNames = [
        "business",
        "mailing",
        "headquarters",
        "form-d:offering",
        "form-c:issuer",
        "subsidiary",
      ];

      relationNames.forEach((relationName) => {
        const junction: AddressesEntityHistoryJunction = {
          relation_name: relationName,
          cik: 1234567,
          address_hash_id: "hash123",
          valid_from: "2024-01-01T00:00:00Z",
          valid_to: null,
          change_source: "10-K",
          change_date: "2024-01-01T00:00:00Z",
        };

        const isValid = Value.Check(AddressesEntityHistoryJunctionSchema, junction);
        expect(isValid).toBe(true);
      });
    });

    it("should reject relation names exceeding max length", () => {
      const junction = {
        relation_name: "a".repeat(51), // 51 characters, exceeds maxLength of 50
        cik: 1234567,
        address_hash_id: "hash123",
        valid_from: "2024-01-01T00:00:00Z",
        valid_to: null,
        change_source: "10-K",
        change_date: "2024-01-01T00:00:00Z",
      };

      const isValid = Value.Check(AddressesEntityHistoryJunctionSchema, junction);
      expect(isValid).toBe(false);
    });
  });
});
