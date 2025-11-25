/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { InMemoryTabularRepository } from "@podley/storage";
import { CrowdfundingTemporalRepo } from "./CrowdfundingTemporalRepo";
import { CrowdfundingRepo } from "./CrowdfundingRepo";
import {
  CrowdfundingHistory,
  CrowdfundingHistoryRepositoryStorage,
  CrowdfundingHistorySchema,
  CrowdfundingHistoryPrimaryKeyNames,
} from "./CrowdfundingHistorySchema";
import {
  ChangeLog,
  ChangeLogRepositoryStorage,
  ChangeLogSchema,
  ChangeLogPrimaryKeyNames,
} from "../change-tracking/ChangeLogSchema";
import {
  Crowdfunding,
  CrowdfundingRepositoryStorage,
  CrowdfundingSchema,
  CrowdfundingPrimaryKeyNames,
} from "./CrowdfundingSchema";

describe("CrowdfundingTemporalRepo", () => {
  let temporalRepo: CrowdfundingTemporalRepo;
  let mockCrowdfundingRepo: InMemoryTabularRepository<
    typeof CrowdfundingSchema,
    typeof CrowdfundingPrimaryKeyNames,
    Crowdfunding
  >;
  let mockHistoryRepo: InMemoryTabularRepository<
    typeof CrowdfundingHistorySchema,
    typeof CrowdfundingHistoryPrimaryKeyNames,
    CrowdfundingHistory
  >;
  let mockChangeLogRepo: InMemoryTabularRepository<
    typeof ChangeLogSchema,
    typeof ChangeLogPrimaryKeyNames,
    ChangeLog
  >;

  beforeEach(() => {
    mockCrowdfundingRepo = new InMemoryTabularRepository(
      CrowdfundingSchema,
      CrowdfundingPrimaryKeyNames
    );
    mockHistoryRepo = new InMemoryTabularRepository(
      CrowdfundingHistorySchema,
      CrowdfundingHistoryPrimaryKeyNames,
      ["cik", "file_number"]
    );
    mockChangeLogRepo = new InMemoryTabularRepository(
      ChangeLogSchema,
      ChangeLogPrimaryKeyNames,
      ["entity_type", "entity_id"]
    );

    const crowdfundingRepo = new CrowdfundingRepo({
      crowdfundingRepository: mockCrowdfundingRepo as unknown as CrowdfundingRepositoryStorage,
      crowdfundingOfferingsRepository: {} as any,
      crowdfundingReportsRepository: {} as any,
    });

    temporalRepo = new CrowdfundingTemporalRepo({
      crowdfundingRepo,
      crowdfundingHistoryRepository:
        mockHistoryRepo as unknown as CrowdfundingHistoryRepositoryStorage,
      changeLogRepository: mockChangeLogRepo as unknown as ChangeLogRepositoryStorage,
    });
  });

  test("should save new crowdfunding entity with history and change log", async () => {
    const crowdfunding: Crowdfunding = {
      cik: 12345,
      file_number: "020-12345",
      filing_date: "2024-01-01",
      name: "Test Crowdfunding",
      legal_status: "Corporation",
      state_jurisdiction: "DE",
      date_incorporation: "2023-01-01",
      url: "http://example.com",
      portal_cik: 54321,
      status: "Active",
    };

    await temporalRepo.saveCrowdfundingWithHistory(crowdfunding, "TEST_SOURCE");

    // Check main repo
    const saved = await temporalRepo.getCrowdfunding(12345, "020-12345");
    expect(saved).toEqual(crowdfunding);

    // Check history
    const history = await temporalRepo.getCrowdfundingHistory(12345, "020-12345");
    expect(history).toHaveLength(1);
    expect(history[0].change_source).toBe("TEST_SOURCE");
    expect(history[0].valid_to).toBeNull();
    expect(history[0].name).toBe("Test Crowdfunding");

    // Check change log
    const changes = await temporalRepo.getCrowdfundingChanges(12345, "020-12345");
    expect(changes).toHaveLength(1);
    expect(changes[0].change_type).toBe("create");
    expect(changes[0].new_value).toContain("Test Crowdfunding");
  });

  test("should update existing crowdfunding entity and track history", async () => {
    const initial: Crowdfunding = {
      cik: 12345,
      file_number: "020-12345",
      filing_date: "2024-01-01",
      name: "Test Crowdfunding",
      legal_status: "Corporation",
      state_jurisdiction: "DE",
      date_incorporation: "2023-01-01",
      url: "http://example.com",
      portal_cik: 54321,
      status: "Active",
    };

    await temporalRepo.saveCrowdfundingWithHistory(initial, "INITIAL_SOURCE");

    // Wait a bit to ensure timestamps are different (though mock doesn't strictly need it, good for realism)
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated: Crowdfunding = {
      ...initial,
      name: "Updated Crowdfunding",
      status: "Inactive",
    };

    await temporalRepo.saveCrowdfundingWithHistory(updated, "UPDATE_SOURCE");

    // Check main repo
    const saved = await temporalRepo.getCrowdfunding(12345, "020-12345");
    expect(saved?.name).toBe("Updated Crowdfunding");
    expect(saved?.status).toBe("Inactive");

    // Check history
    const history = await temporalRepo.getCrowdfundingHistory(12345, "020-12345");
    expect(history).toHaveLength(2);

    // Sort by valid_from desc (default in getCrowdfundingHistory)
    const [newest, oldest] = history;

    expect(newest.name).toBe("Updated Crowdfunding");
    expect(newest.valid_to).toBeNull();
    expect(newest.change_source).toBe("UPDATE_SOURCE");

    expect(oldest.name).toBe("Test Crowdfunding");
    expect(oldest.valid_to).not.toBeNull();
    expect(oldest.change_source).toBe("INITIAL_SOURCE");

    // Check change log
    const changes = await temporalRepo.getCrowdfundingChanges(12345, "020-12345");
    // 1 create + 2 updates (name, status)
    expect(changes).toHaveLength(3);

    const nameChange = changes.find((c) => c.field_name === "name" && c.change_type === "update");
    expect(nameChange).toBeDefined();
    expect(nameChange?.old_value).toBe("Test Crowdfunding");
    expect(nameChange?.new_value).toBe("Updated Crowdfunding");

    const statusChange = changes.find(
      (c) => c.field_name === "status" && c.change_type === "update"
    );
    expect(statusChange).toBeDefined();
    expect(statusChange?.old_value).toBe("Active");
    expect(statusChange?.new_value).toBe("Inactive");
  });

  test("should retrieve crowdfunding entity at specific time", async () => {
    const initial: Crowdfunding = {
      cik: 12345,
      file_number: "020-12345",
      filing_date: "2024-01-01",
      name: "Initial Name",
      legal_status: "Corporation",
      state_jurisdiction: "DE",
      date_incorporation: "2023-01-01",
      url: "http://example.com",
      portal_cik: 54321,
      status: "Active",
    };

    await temporalRepo.saveCrowdfundingWithHistory(initial, "INITIAL");
    const time1 = new Date();

    await new Promise((resolve) => setTimeout(resolve, 100));

    const updated: Crowdfunding = {
      ...initial,
      name: "Updated Name",
    };

    await temporalRepo.saveCrowdfundingWithHistory(updated, "UPDATE");
    const time2 = new Date();

    const entityAtTime1 = await temporalRepo.getCrowdfundingAtTime(12345, "020-12345", time1);
    expect(entityAtTime1?.name).toBe("Initial Name");

    const entityAtTime2 = await temporalRepo.getCrowdfundingAtTime(12345, "020-12345", time2);
    expect(entityAtTime2?.name).toBe("Updated Name");
  });
});
