/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { InMemoryTabularStorage } from "workglow";
import {
  ChangeLog,
  ChangeLogPrimaryKeyNames,
  ChangeLogRepositoryStorage,
  ChangeLogSchema,
} from "../change-tracking/ChangeLogSchema";
import {
  CrowdfundingHistory,
  CrowdfundingHistoryPrimaryKeyNames,
  CrowdfundingHistoryRepositoryStorage,
  CrowdfundingHistorySchema,
} from "./CrowdfundingHistorySchema";
import { CrowdfundingRepo } from "./CrowdfundingRepo";
import {
  Crowdfunding,
  CrowdfundingPrimaryKeyNames,
  CrowdfundingRepositoryStorage,
  CrowdfundingSchema,
} from "./CrowdfundingSchema";
import { CrowdfundingTemporalRepo } from "./CrowdfundingTemporalRepo";

describe("CrowdfundingTemporalRepo", () => {
  let temporalRepo: CrowdfundingTemporalRepo;
  let mockCrowdfundingRepo: InMemoryTabularStorage<
    typeof CrowdfundingSchema,
    typeof CrowdfundingPrimaryKeyNames,
    Crowdfunding
  >;
  let mockHistoryRepo: InMemoryTabularStorage<
    typeof CrowdfundingHistorySchema,
    typeof CrowdfundingHistoryPrimaryKeyNames,
    CrowdfundingHistory
  >;
  let mockChangeLogRepo: InMemoryTabularStorage<
    typeof ChangeLogSchema,
    typeof ChangeLogPrimaryKeyNames,
    ChangeLog
  >;

  beforeEach(() => {
    mockCrowdfundingRepo = new InMemoryTabularStorage(
      CrowdfundingSchema,
      CrowdfundingPrimaryKeyNames
    );
    mockHistoryRepo = new InMemoryTabularStorage(
      CrowdfundingHistorySchema,
      CrowdfundingHistoryPrimaryKeyNames,
      ["cik", "file_number"]
    );
    mockChangeLogRepo = new InMemoryTabularStorage(ChangeLogSchema, ChangeLogPrimaryKeyNames, [
      "entity_type",
      "entity_id",
    ]);

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

  test("skipMutableUpdate writes a closed history row, no mutable row, no ChangeLog", async () => {
    const crowdfunding: Crowdfunding = {
      cik: 99999,
      file_number: "020-99999",
      filing_date: "2025-04-28",
      name: "Stale Replay Issuer",
      legal_status: "Corporation",
      state_jurisdiction: "DE",
      date_incorporation: "2020-01-01",
      url: "http://example.com",
      portal_cik: 12345,
      status: "annual-report",
    };

    await temporalRepo.saveCrowdfundingWithHistory(crowdfunding, "STALE_REPLAY", {
      skipMutableUpdate: true,
    });

    // No mutable row.
    const mutable = await temporalRepo.getCrowdfunding(99999, "020-99999");
    expect(mutable).toBeUndefined();

    // One closed history row (valid_from === valid_to).
    const history = await temporalRepo.getCrowdfundingHistory(99999, "020-99999");
    expect(history).toHaveLength(1);
    expect(history[0].valid_to).not.toBeNull();
    expect(history[0].valid_to).toBe(history[0].valid_from);
    expect(history[0].change_source).toBe("STALE_REPLAY");
    expect(history[0].name).toBe("Stale Replay Issuer");

    // No ChangeLog entry.
    const changes = await temporalRepo.getCrowdfundingChanges(99999, "020-99999");
    expect(changes).toHaveLength(0);
  });

  // Regression: closed-immediately (stale-replay) history rows must be
  // visible to getCrowdfundingAtTime. Approach: half-open intervals stay
  // [valid_from, valid_to) for normal rows, but rows where valid_from ===
  // valid_to are matched at the single instant valid_from. When a dominant
  // (open or non-closed-immediately) row also matches the same instant the
  // dominant row wins.
  test("getCrowdfundingAtTime surfaces a stale-replay snapshot at its instant", async () => {
    const stale: Crowdfunding = {
      cik: 88888,
      file_number: "020-88888",
      filing_date: "2024-01-01",
      name: "Stale Replay Snapshot",
      legal_status: "Corporation",
      state_jurisdiction: "DE",
      date_incorporation: "2020-01-01",
      url: "http://example.com",
      portal_cik: 11111,
      status: "annual-report",
    };

    await temporalRepo.saveCrowdfundingWithHistory(stale, "Form C-AR", {
      skipMutableUpdate: true,
    });

    const history = await temporalRepo.getCrowdfundingHistory(88888, "020-88888");
    expect(history).toHaveLength(1);
    expect(history[0].valid_to).toBe(history[0].valid_from);

    // The snapshot's instant: getCrowdfundingAtTime must surface it (was
    // invisible under strict `>` on valid_to).
    const at = await temporalRepo.getCrowdfundingAtTime(
      88888,
      "020-88888",
      new Date(history[0].valid_from)
    );
    expect(at?.name).toBe("Stale Replay Snapshot");
  });

  test("getCrowdfundingAtTime prefers dominant row when both match the same instant", async () => {
    // Seed an open dominant row, then write a stale-replay snapshot whose
    // valid_from happens to fall inside the dominant row's interval. The
    // dominant row should win at the snapshot's instant.
    const dominant: Crowdfunding = {
      cik: 77777,
      file_number: "020-77777",
      filing_date: "2024-01-01",
      name: "Dominant Open Row",
      legal_status: "Corporation",
      state_jurisdiction: "DE",
      date_incorporation: "2020-01-01",
      url: "http://example.com",
      portal_cik: 22222,
      status: "active",
    };
    await temporalRepo.saveCrowdfundingWithHistory(dominant, "Form C");

    await new Promise((resolve) => setTimeout(resolve, 10));

    const replay: Crowdfunding = {
      ...dominant,
      name: "Stale Older Snapshot",
      status: "annual-report",
    };
    await temporalRepo.saveCrowdfundingWithHistory(replay, "Form C-AR", {
      skipMutableUpdate: true,
    });

    const history = await temporalRepo.getCrowdfundingHistory(77777, "020-77777");
    const closedImmediate = history.find((h) => h.valid_to !== null && h.valid_to === h.valid_from);
    expect(closedImmediate).toBeDefined();

    const at = await temporalRepo.getCrowdfundingAtTime(
      77777,
      "020-77777",
      new Date(closedImmediate!.valid_from)
    );
    // Dominant row wins at the overlap instant.
    expect(at?.name).toBe("Dominant Open Row");

    // Stale-replay snapshot still discoverable via history listing.
    expect(history.some((h) => h.name === "Stale Older Snapshot")).toBe(true);
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
