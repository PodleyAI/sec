//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryTabularRepository } from "@podley/storage";
import { beforeEach, describe, expect, it } from "bun:test";
import { InvestmentOfferingRepo } from "./InvestmentOfferingRepo";
import {
  InvestmentOfferingSchema,
  type InvestmentOffering,
  InvestmentOfferingPrimaryKeyNames,
  type InvestmentOfferingRepositoryStorage,
} from "./InvestmentOfferingSchema";
import {
  InvestmentOfferingHistorySchema,
  type InvestmentOfferingHistory,
  InvestmentOfferingHistoryPrimaryKeyNames,
  type InvestmentOfferingHistoryRepositoryStorage,
} from "./InvestmentOfferingHistorySchema";

describe("InvestmentOfferingRepo", () => {
  let investmentOfferingRepo: InvestmentOfferingRepo;
  let investmentOfferingStorage: InvestmentOfferingRepositoryStorage;
  let investmentOfferingHistoryStorage: InvestmentOfferingHistoryRepositoryStorage;

  beforeEach(() => {
    // Create real in-memory repositories with appropriate indexes
    investmentOfferingStorage = new InMemoryTabularRepository(
      InvestmentOfferingSchema,
      InvestmentOfferingPrimaryKeyNames,
      [
        ["cik"],
        ["file_number"],
        ["industry_group"],
        ["industry_subgroup"],
        ["is_debt_type"],
        ["is_equity_type"],
        ["is_pooled_investment_type"],
      ]
    );

    investmentOfferingHistoryStorage = new InMemoryTabularRepository(
      InvestmentOfferingHistorySchema,
      InvestmentOfferingHistoryPrimaryKeyNames,
      [
        ["cik"],
        ["file_number"],
        ["accession_number"],
        ["minimum_investment_accepted"],
        ["total_offering_amount"],
        ["investor_count"],
        ["non_accredited_count"],
      ]
    );

    investmentOfferingRepo = new InvestmentOfferingRepo({
      investmentOfferingRepository: investmentOfferingStorage,
      investmentOfferingHistoryRepository: investmentOfferingHistoryStorage,
    });
  });

  const mockOffering: InvestmentOffering = {
    cik: 123456,
    file_number: "021-12345",
    industry_group: "Technology",
    industry_subgroup: "Software",
    date_of_first_sale: "2024-01-15",
    exemptions: ["Rule 506(b)", "Rule 506(c)"],
    is_debt_type: false,
    is_equity_type: true,
    is_mineral_property_type: false,
    is_option_to_aquire_type: false,
    is_pooled_investment_type: false,
    is_security_to_be_aquired: false,
    is_tenant_in_common: false,
    is_business_combination_type: false,
    is_other_type: false,
    description_of_other: null,
  };

  const mockOfferingHistory: InvestmentOfferingHistory = {
    cik: 123456,
    file_number: "021-12345",
    accession_number: "0001234567",
    minimum_investment_accepted: 25000,
    total_offering_amount: 5000000,
    total_amount_sold: 3000000,
    total_remaining: 2000000,
    investor_count: 50,
    non_accredited_count: 10,
  };

  // ================================
  // Investment Offering Tests
  // ================================

  describe("Investment Offering Methods", () => {
    describe("getInvestmentOffering", () => {
      it("should retrieve an investment offering by cik and file_number", async () => {
        await investmentOfferingStorage.put(mockOffering);

        const result = await investmentOfferingRepo.getInvestmentOffering(123456, "021-12345");

        expect(result).toEqual(mockOffering);
      });

      it("should return undefined if offering not found", async () => {
        const result = await investmentOfferingRepo.getInvestmentOffering(999999, "nonexistent");

        expect(result).toBeUndefined();
      });
    });

    describe("saveInvestmentOffering", () => {
      it("should save an investment offering", async () => {
        const result = await investmentOfferingRepo.saveInvestmentOffering(mockOffering);

        expect(result).toEqual(mockOffering);

        // Verify it was actually saved
        const savedOffering = await investmentOfferingStorage.get({
          cik: mockOffering.cik,
          file_number: mockOffering.file_number,
        });
        expect(savedOffering).toEqual(mockOffering);
      });
    });

    describe("getInvestmentOfferingsByCik", () => {
      it("should return offerings associated with a cik", async () => {
        const offering1 = { ...mockOffering };
        const offering2 = { ...mockOffering, file_number: "021-67890" };

        await investmentOfferingStorage.put(offering1);
        await investmentOfferingStorage.put(offering2);

        const result = await investmentOfferingRepo.getInvestmentOfferingsByCik(123456);

        expect(result).toHaveLength(2);
        expect(result).toContainEqual(offering1);
        expect(result).toContainEqual(offering2);
      });
    });

    describe("getInvestmentOfferingsBySecurityType", () => {
      it("should retrieve offerings by security type - equity", async () => {
        const equityOffering = { ...mockOffering };
        const debtOffering = {
          ...mockOffering,
          file_number: "021-67890",
          is_equity_type: false,
          is_debt_type: true,
        };

        await investmentOfferingStorage.put(equityOffering);
        await investmentOfferingStorage.put(debtOffering);

        const result = await investmentOfferingRepo.getInvestmentOfferingsBySecurityType(
          "is_equity_type",
          true
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(equityOffering);
      });
    });
  });

  // ================================
  // Investment Offering History Tests
  // ================================

  describe("Investment Offering History Methods", () => {
    describe("getInvestmentOfferingHistory", () => {
      it("should retrieve an investment offering history by cik, file_number, and accession_number", async () => {
        await investmentOfferingHistoryStorage.put(mockOfferingHistory);

        const result = await investmentOfferingRepo.getInvestmentOfferingHistory(
          123456,
          "021-12345",
          "0001234567"
        );

        expect(result).toEqual(mockOfferingHistory);
      });

      it("should return undefined if offering history not found", async () => {
        const result = await investmentOfferingRepo.getInvestmentOfferingHistory(
          999999,
          "nonexistent",
          "0000000000"
        );

        expect(result).toBeUndefined();
      });
    });

    describe("saveInvestmentOfferingHistory", () => {
      it("should save an investment offering history", async () => {
        const result = await investmentOfferingRepo.saveInvestmentOfferingHistory(
          mockOfferingHistory
        );

        expect(result).toEqual(mockOfferingHistory);

        // Verify it was actually saved
        const savedOfferingHistory = await investmentOfferingHistoryStorage.get({
          cik: mockOfferingHistory.cik,
          file_number: mockOfferingHistory.file_number,
          accession_number: mockOfferingHistory.accession_number,
        });
        expect(savedOfferingHistory).toEqual(mockOfferingHistory);
      });
    });

    describe("getInvestmentOfferingHistoriesByCikAndFileNumber", () => {
      it("should retrieve offering histories by cik and file number", async () => {
        const history1 = { ...mockOfferingHistory };
        const history2 = { ...mockOfferingHistory, accession_number: "0001234568" };
        const history3 = { ...mockOfferingHistory, cik: 789012, accession_number: "0001234569" };

        await investmentOfferingHistoryStorage.put(history1);
        await investmentOfferingHistoryStorage.put(history2);
        await investmentOfferingHistoryStorage.put(history3);

        const result =
          await investmentOfferingRepo.getInvestmentOfferingHistoriesByCikAndFileNumber(
            123456,
            "021-12345"
          );

        expect(result).toHaveLength(2);
        expect(result).toContainEqual(history1);
        expect(result).toContainEqual(history2);
        expect(result).not.toContainEqual(history3);
      });
    });

    describe("getInvestmentOfferingHistoriesWithMinimumInvestmentAbove", () => {
      it("should retrieve offering histories with minimum investment above threshold", async () => {
        const lowMinimumHistory = { ...mockOfferingHistory, minimum_investment_accepted: 10000 };
        const highMinimumHistory = {
          ...mockOfferingHistory,
          accession_number: "0001234568",
          minimum_investment_accepted: 50000,
        };

        await investmentOfferingHistoryStorage.put(lowMinimumHistory);
        await investmentOfferingHistoryStorage.put(highMinimumHistory);

        const result =
          await investmentOfferingRepo.getInvestmentOfferingHistoriesWithMinimumInvestmentAbove(
            20000
          );

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(highMinimumHistory);
      });
    });

    describe("getInvestmentOfferingHistoriesWithNonAccreditedInvestors", () => {
      it("should retrieve offering histories with non-accredited investors", async () => {
        const noNonAccreditedHistory = { ...mockOfferingHistory, non_accredited_count: 0 };
        const withNonAccreditedHistory = {
          ...mockOfferingHistory,
          accession_number: "0001234568",
          non_accredited_count: 5,
        };

        await investmentOfferingHistoryStorage.put(noNonAccreditedHistory);
        await investmentOfferingHistoryStorage.put(withNonAccreditedHistory);

        const result =
          await investmentOfferingRepo.getInvestmentOfferingHistoriesWithNonAccreditedInvestors();

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(withNonAccreditedHistory);
      });
    });
  });

  // ================================
  // Combined Methods Tests
  // ================================

  describe("Combined Methods", () => {
    describe("getInvestmentOfferingWithHistory", () => {
      it("should retrieve both offering and its history", async () => {
        await investmentOfferingStorage.put(mockOffering);
        await investmentOfferingHistoryStorage.put(mockOfferingHistory);
        const history2 = { ...mockOfferingHistory, accession_number: "0001234568" };
        await investmentOfferingHistoryStorage.put(history2);

        const result = await investmentOfferingRepo.getInvestmentOfferingWithHistory(
          123456,
          "021-12345"
        );

        expect(result.offering).toEqual(mockOffering);
        expect(result.history).toHaveLength(2);
        expect(result.history).toContainEqual(mockOfferingHistory);
        expect(result.history).toContainEqual(history2);
      });

      it("should return undefined offering and empty history if not found", async () => {
        const result = await investmentOfferingRepo.getInvestmentOfferingWithHistory(
          999999,
          "nonexistent"
        );

        expect(result.offering).toBeUndefined();
        expect(result.history).toEqual([]);
      });
    });

    describe("saveInvestmentOfferingWithHistory", () => {
      it("should save both offering and history", async () => {
        const result = await investmentOfferingRepo.saveInvestmentOfferingWithHistory(
          mockOffering,
          mockOfferingHistory
        );

        expect(result.offering).toEqual(mockOffering);
        expect(result.history).toEqual(mockOfferingHistory);

        // Verify both were saved
        const savedOffering = await investmentOfferingStorage.get({
          cik: mockOffering.cik,
          file_number: mockOffering.file_number,
        });
        const savedHistory = await investmentOfferingHistoryStorage.get({
          cik: mockOfferingHistory.cik,
          file_number: mockOfferingHistory.file_number,
          accession_number: mockOfferingHistory.accession_number,
        });

        expect(savedOffering).toEqual(mockOffering);
        expect(savedHistory).toEqual(mockOfferingHistory);
      });

      it("should throw error if cik and file_number don't match", async () => {
        const mismatchedHistory = {
          ...mockOfferingHistory,
          cik: 999999, // Different CIK
        };

        await expect(
          investmentOfferingRepo.saveInvestmentOfferingWithHistory(mockOffering, mismatchedHistory)
        ).rejects.toThrow("Investment offering and history must have matching CIK and file number");
      });
    });
  });
});
