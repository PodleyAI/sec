//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { globalServiceRegistry } from "@podley/util";
import { EntityRepo } from "./EntityRepo";
import { Entity } from "./EntitySchema";
import {
  ENTITY_HISTORY_REPOSITORY_TOKEN,
  EntityHistory,
  EntityHistoryRepositoryStorage,
} from "./EntityHistorySchema";
import {
  CHANGE_LOG_REPOSITORY_TOKEN,
  ChangeLog,
  ChangeLogRepositoryStorage,
} from "../change-tracking/ChangeLogSchema";

interface EntityTemporalRepoOptions {
  entityRepo?: EntityRepo;
  entityHistoryRepository?: EntityHistoryRepositoryStorage;
  changeLogRepository?: ChangeLogRepositoryStorage;
}

/**
 * Temporal Entity repository - extends EntityRepo with history tracking
 */
export class EntityTemporalRepo {
  private entityRepo: EntityRepo;
  private entityHistoryRepository: EntityHistoryRepositoryStorage;
  private changeLogRepository: ChangeLogRepositoryStorage;

  constructor(options: EntityTemporalRepoOptions = {}) {
    this.entityRepo = options.entityRepo ?? new EntityRepo();
    this.entityHistoryRepository =
      options.entityHistoryRepository ?? globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN);
    this.changeLogRepository =
      options.changeLogRepository ?? globalServiceRegistry.get(CHANGE_LOG_REPOSITORY_TOKEN);
  }

  /**
   * Save an entity with history tracking
   */
  async saveEntityWithHistory(
    entity: Entity,
    changeSource: string,
    batchId?: string
  ): Promise<void> {
    const existingEntity = await this.entityRepo.getEntity(entity.cik);
    const changeDate = new Date().toISOString();

    // If entity exists, create history record for the old version
    if (existingEntity) {
      const changes = this.detectChanges(existingEntity, entity);

      if (changes.length > 0) {
        // Close the current history record
        const currentHistory = await this.getCurrentEntityHistory(entity.cik);
        if (currentHistory) {
          currentHistory.valid_to = changeDate;
          await this.entityHistoryRepository.put(currentHistory);
        }

        // Create new history record
        const history: EntityHistory = {
          ...entity,
          valid_from: changeDate,
          valid_to: null,
          change_source: changeSource,
          change_date: changeDate,
        };
        await this.entityHistoryRepository.put(history);

        // Log individual field changes
        for (const change of changes) {
          const changeLog: ChangeLog = {
            change_id: crypto.randomUUID(),
            entity_type: "entity",
            entity_id: entity.cik.toString(),
            field_name: change.field,
            old_value: change.oldValue,
            new_value: change.newValue,
            change_type: "update",
            change_source: changeSource,
            change_date: changeDate,
            filing_accession_number: null,
            batch_id: batchId ?? null,
            user_id: null,
            metadata: null,
          };
          await this.changeLogRepository.put(changeLog);
        }
      }
    } else {
      // New entity - create initial history record
      const history: EntityHistory = {
        ...entity,
        valid_from: changeDate,
        valid_to: null,
        change_source: changeSource,
        change_date: changeDate,
      };
      await this.entityHistoryRepository.put(history);

      // Log creation
      const changeLog: ChangeLog = {
        change_id: crypto.randomUUID(),
        entity_type: "entity",
        entity_id: entity.cik.toString(),
        field_name: "*",
        old_value: null,
        new_value: JSON.stringify(entity),
        change_type: "create",
        change_source: changeSource,
        change_date: changeDate,
        filing_accession_number: null,
        batch_id: batchId ?? null,
        user_id: null,
        metadata: null,
      };
      await this.changeLogRepository.put(changeLog);
    }

    // Save to main entity table
    await this.entityRepo.saveEntity(entity);
  }

  /**
   * Get entity at a specific point in time
   */
  async getEntityAtTime(cik: number, timestamp: Date): Promise<Entity | undefined> {
    const history = await this.entityHistoryRepository.search({ cik });

    if (!history || history.length === 0) {
      return undefined;
    }

    // Find the record that was valid at the given timestamp
    const timestampStr = timestamp.toISOString();
    const validRecord = history.find((record) => {
      const isAfterStart = record.valid_from <= timestampStr;
      const isBeforeEnd = !record.valid_to || record.valid_to > timestampStr;
      return isAfterStart && isBeforeEnd;
    });

    if (validRecord) {
      const { change_source, change_date, valid_from, valid_to, ...entity } = validRecord;
      return entity as Entity;
    }

    return undefined;
  }

  /**
   * Get entity history
   */
  async getEntityHistory(cik: number): Promise<EntityHistory[]> {
    const history = await this.entityHistoryRepository.search({ cik });
    return (
      history?.sort(
        (a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime()
      ) || []
    );
  }

  /**
   * Get changes for an entity
   */
  async getEntityChanges(cik: number): Promise<ChangeLog[]> {
    const changes = await this.changeLogRepository.search({
      entity_type: "entity",
      entity_id: cik.toString(),
    });
    return (
      changes?.sort(
        (a, b) => new Date(b.change_date).getTime() - new Date(a.change_date).getTime()
      ) || []
    );
  }

  /**
   * Get current entity history record
   */
  private async getCurrentEntityHistory(cik: number): Promise<EntityHistory | undefined> {
    const history = await this.entityHistoryRepository.search({
      cik,
      valid_to: null,
    });
    return history?.[0];
  }

  /**
   * Detect changes between two entities
   */
  private detectChanges(
    oldEntity: Entity,
    newEntity: Entity
  ): Array<{
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }> {
    const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
    const fields: (keyof Entity)[] = [
      "name",
      "type",
      "sic",
      "ein",
      "description",
      "website",
      "investor_website",
      "category",
      "fiscal_year",
      "state_incorporation",
      "state_incorporation_desc",
    ];

    for (const field of fields) {
      if (oldEntity[field] !== newEntity[field]) {
        changes.push({
          field,
          oldValue: oldEntity[field]?.toString() ?? null,
          newValue: newEntity[field]?.toString() ?? null,
        });
      }
    }

    return changes;
  }

  /**
   * Get SIC code changes for an entity
   */
  async getEntitySicHistory(cik: number): Promise<
    Array<{
      sic: number | null;
      valid_from: string;
      valid_to: string | null;
      change_source: string;
    }>
  > {
    const history = await this.getEntityHistory(cik);
    const sicHistory: Array<{
      sic: number | null;
      valid_from: string;
      valid_to: string | null;
      change_source: string;
    }> = [];

    // Process history oldest-first to capture the earliest record for each SIC period
    const sortedHistory = [...history].sort(
      (a, b) => new Date(a.valid_from).getTime() - new Date(b.valid_from).getTime()
    );

    let previousSic: number | null = null;

    for (const record of sortedHistory) {
      if (record.sic !== previousSic) {
        sicHistory.push({
          sic: record.sic,
          valid_from: record.valid_from,
          valid_to: record.valid_to,
          change_source: record.change_source,
        });
        previousSic = record.sic;
      }
    }

    // Return sorted newest-first to match expected test output
    return sicHistory.reverse();
  }

  /**
   * Delegate standard entity operations to EntityRepo
   */
  async getEntity(cik: number): Promise<Entity | undefined> {
    return this.entityRepo.getEntity(cik);
  }

  async searchEntities(criteria: Partial<Entity>): Promise<Entity[]> {
    return this.entityRepo.searchEntities(criteria);
  }

  async getAllEntities(): Promise<Entity[]> {
    return this.entityRepo.getAllEntities();
  }
}
