//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it, beforeEach, mock } from "bun:test";
import { EntityTemporalRepo } from "./EntityTemporalRepo";
import { Entity } from "./EntitySchema";
import { EntityHistory } from "./EntityHistorySchema";
import { ChangeLog } from "../change-tracking/ChangeLogSchema";

// Mock crypto.randomUUID
global.crypto = {
  randomUUID: mock(() => "test-uuid-" + Math.random()),
} as any;

describe("EntityTemporalRepo", () => {
  let mockEntityRepo: any;
  let mockEntityHistoryRepository: any;
  let mockChangeLogRepository: any;
  let entityTemporalRepo: EntityTemporalRepo;

  beforeEach(() => {
    // Reset mocks
    mockEntityRepo = {
      getEntity: mock(),
      saveEntity: mock(),
      searchEntities: mock(),
      getAllEntities: mock(),
    };

    mockEntityHistoryRepository = {
      get: mock(),
      put: mock(),
      search: mock(),
      getAll: mock(),
    };

    mockChangeLogRepository = {
      get: mock(),
      put: mock(),
      search: mock(),
      getAll: mock(),
    };

    entityTemporalRepo = new EntityTemporalRepo({
      entityRepo: mockEntityRepo,
      entityHistoryRepository: mockEntityHistoryRepository,
      changeLogRepository: mockChangeLogRepository,
    });
  });

  describe("saveEntityWithHistory", () => {
    const testEntity: Entity = {
      cik: 1234567,
      name: "Test Company Inc.",
      type: "Corporation",
      sic: 3841,
      ein: "12-3456789",
      description: "A test company",
      website: "https://test.com",
      investor_website: "https://investors.test.com",
      category: "Large accelerated filer",
      fiscal_year: "1231",
      state_incorporation: "DE",
      state_incorporation_desc: "Delaware",
    };

    it("should create new entity with initial history record", async () => {
      mockEntityRepo.getEntity.mockResolvedValue(undefined);
      mockEntityHistoryRepository.search.mockResolvedValue([]);

      await entityTemporalRepo.saveEntityWithHistory(testEntity, "10-K", "batch-123");

      // Should save entity
      expect(mockEntityRepo.saveEntity).toHaveBeenCalledWith(testEntity);

      // Should create history record
      expect(mockEntityHistoryRepository.put).toHaveBeenCalledWith(
        expect.objectContaining({
          ...testEntity,
          valid_from: expect.any(String),
          valid_to: null,
          change_source: "10-K",
          change_date: expect.any(String),
        })
      );

      // Should create change log for creation
      expect(mockChangeLogRepository.put).toHaveBeenCalledWith(
        expect.objectContaining({
          change_id: expect.stringContaining("test-uuid-"),
          entity_type: "entity",
          entity_id: "1234567",
          field_name: "*",
          old_value: null,
          new_value: JSON.stringify(testEntity),
          change_type: "create",
          change_source: "10-K",
          batch_id: "batch-123",
        })
      );
    });

    it("should track changes to existing entity", async () => {
      const existingEntity: Entity = {
        ...testEntity,
        name: "Old Company Name",
        sic: 3842,
      };

      const currentHistory: EntityHistory = {
        ...existingEntity,
        valid_from: "2023-01-01T00:00:00Z",
        valid_to: null,
        change_source: "8-K",
        change_date: "2023-01-01T00:00:00Z",
      };

      mockEntityRepo.getEntity.mockResolvedValue(existingEntity);
      mockEntityHistoryRepository.search.mockResolvedValue([currentHistory]);

      await entityTemporalRepo.saveEntityWithHistory(testEntity, "10-K");

      // Should close current history record
      expect(mockEntityHistoryRepository.put).toHaveBeenCalledWith(
        expect.objectContaining({
          ...currentHistory,
          valid_to: expect.any(String),
        })
      );

      // Should create new history record
      expect(mockEntityHistoryRepository.put).toHaveBeenCalledWith(
        expect.objectContaining({
          ...testEntity,
          valid_from: expect.any(String),
          valid_to: null,
          change_source: "10-K",
        })
      );

      // Should log individual field changes
      expect(mockChangeLogRepository.put).toHaveBeenCalledTimes(2); // name and sic
      expect(mockChangeLogRepository.put).toHaveBeenCalledWith(
        expect.objectContaining({
          field_name: "name",
          old_value: "Old Company Name",
          new_value: "Test Company Inc.",
          change_type: "update",
        })
      );
      expect(mockChangeLogRepository.put).toHaveBeenCalledWith(
        expect.objectContaining({
          field_name: "sic",
          old_value: "3842",
          new_value: "3841",
          change_type: "update",
        })
      );
    });

    it("should not create history if no changes detected", async () => {
      mockEntityRepo.getEntity.mockResolvedValue(testEntity);

      await entityTemporalRepo.saveEntityWithHistory(testEntity, "10-K");

      // Should still save entity (in case of forced save)
      expect(mockEntityRepo.saveEntity).toHaveBeenCalledWith(testEntity);

      // Should not create any history records or change logs
      expect(mockEntityHistoryRepository.put).not.toHaveBeenCalled();
      expect(mockChangeLogRepository.put).not.toHaveBeenCalled();
    });
  });

  describe("getEntityAtTime", () => {
    it("should return entity valid at specific time", async () => {
      const history: EntityHistory[] = [
        {
          cik: 1234567,
          name: "Current Name",
          type: "Corporation",
          sic: 3841,
          ein: null,
          description: null,
          website: null,
          investor_website: null,
          category: null,
          fiscal_year: null,
          state_incorporation: "DE",
          state_incorporation_desc: null,
          valid_from: "2024-01-01T00:00:00Z",
          valid_to: null,
          change_source: "10-K",
          change_date: "2024-01-01T00:00:00Z",
        },
        {
          cik: 1234567,
          name: "Old Name",
          type: "Corporation",
          sic: 3840,
          ein: null,
          description: null,
          website: null,
          investor_website: null,
          category: null,
          fiscal_year: null,
          state_incorporation: "DE",
          state_incorporation_desc: null,
          valid_from: "2023-01-01T00:00:00Z",
          valid_to: "2024-01-01T00:00:00Z",
          change_source: "8-K",
          change_date: "2023-01-01T00:00:00Z",
        },
      ];

      mockEntityHistoryRepository.search.mockResolvedValue(history);

      // Query for time in 2023
      const result = await entityTemporalRepo.getEntityAtTime(
        1234567,
        new Date("2023-06-01T00:00:00Z")
      );

      expect(result).toEqual({
        cik: 1234567,
        name: "Old Name",
        type: "Corporation",
        sic: 3840,
        ein: null,
        description: null,
        website: null,
        investor_website: null,
        category: null,
        fiscal_year: null,
        state_incorporation: "DE",
        state_incorporation_desc: null,
      });
    });

    it("should return undefined if no entity exists at time", async () => {
      mockEntityHistoryRepository.search.mockResolvedValue([]);

      const result = await entityTemporalRepo.getEntityAtTime(
        1234567,
        new Date("2023-06-01T00:00:00Z")
      );

      expect(result).toBeUndefined();
    });
  });

  describe("getEntityHistory", () => {
    it("should return sorted history records", async () => {
      const history: EntityHistory[] = [
        {
          cik: 1234567,
          name: "Name 1",
          type: null,
          sic: null,
          ein: null,
          description: null,
          website: null,
          investor_website: null,
          category: null,
          fiscal_year: null,
          state_incorporation: null,
          state_incorporation_desc: null,
          valid_from: "2022-01-01T00:00:00Z",
          valid_to: "2023-01-01T00:00:00Z",
          change_source: "8-K",
          change_date: "2022-01-01T00:00:00Z",
        },
        {
          cik: 1234567,
          name: "Name 3",
          type: null,
          sic: null,
          ein: null,
          description: null,
          website: null,
          investor_website: null,
          category: null,
          fiscal_year: null,
          state_incorporation: null,
          state_incorporation_desc: null,
          valid_from: "2024-01-01T00:00:00Z",
          valid_to: null,
          change_source: "10-K",
          change_date: "2024-01-01T00:00:00Z",
        },
        {
          cik: 1234567,
          name: "Name 2",
          type: null,
          sic: null,
          ein: null,
          description: null,
          website: null,
          investor_website: null,
          category: null,
          fiscal_year: null,
          state_incorporation: null,
          state_incorporation_desc: null,
          valid_from: "2023-01-01T00:00:00Z",
          valid_to: "2024-01-01T00:00:00Z",
          change_source: "10-Q",
          change_date: "2023-01-01T00:00:00Z",
        },
      ];

      mockEntityHistoryRepository.search.mockResolvedValue(history);

      const result = await entityTemporalRepo.getEntityHistory(1234567);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("Name 3"); // Most recent first
      expect(result[1].name).toBe("Name 2");
      expect(result[2].name).toBe("Name 1");
    });
  });

  describe("getEntitySicHistory", () => {
    it("should return SIC code changes only", async () => {
      const history: EntityHistory[] = [
        {
          cik: 1234567,
          name: "Company",
          type: null,
          sic: 3841,
          ein: null,
          description: null,
          website: null,
          investor_website: null,
          category: null,
          fiscal_year: null,
          state_incorporation: null,
          state_incorporation_desc: null,
          valid_from: "2022-01-01T00:00:00Z",
          valid_to: "2023-01-01T00:00:00Z",
          change_source: "10-K",
          change_date: "2022-01-01T00:00:00Z",
        },
        {
          cik: 1234567,
          name: "Company New Name", // Name changed but SIC stayed same
          type: null,
          sic: 3841,
          ein: null,
          description: null,
          website: null,
          investor_website: null,
          category: null,
          fiscal_year: null,
          state_incorporation: null,
          state_incorporation_desc: null,
          valid_from: "2023-01-01T00:00:00Z",
          valid_to: "2024-01-01T00:00:00Z",
          change_source: "8-K",
          change_date: "2023-01-01T00:00:00Z",
        },
        {
          cik: 1234567,
          name: "Company New Name",
          type: null,
          sic: 3842, // SIC changed
          ein: null,
          description: null,
          website: null,
          investor_website: null,
          category: null,
          fiscal_year: null,
          state_incorporation: null,
          state_incorporation_desc: null,
          valid_from: "2024-01-01T00:00:00Z",
          valid_to: null,
          change_source: "10-K",
          change_date: "2024-01-01T00:00:00Z",
        },
      ];

      mockEntityHistoryRepository.search.mockResolvedValue(history);

      const result = await entityTemporalRepo.getEntitySicHistory(1234567);

      expect(result).toHaveLength(2); // Only 2 unique SIC codes
      expect(result[0]).toEqual({
        sic: 3842,
        valid_from: "2024-01-01T00:00:00Z",
        valid_to: null,
        change_source: "10-K",
      });
      expect(result[1]).toEqual({
        sic: 3841,
        valid_from: "2022-01-01T00:00:00Z",
        valid_to: "2023-01-01T00:00:00Z",
        change_source: "10-K",
      });
    });
  });
});
