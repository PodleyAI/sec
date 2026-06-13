/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CHANGE_LOG_REPOSITORY_TOKEN,
  ChangeLog,
  ChangeLogRepositoryStorage,
} from "../change-tracking/ChangeLogSchema";
import {
  CROWDFUNDING_HISTORY_REPOSITORY_TOKEN,
  CrowdfundingHistory,
  CrowdfundingHistoryRepositoryStorage,
} from "./CrowdfundingHistorySchema";
import { CrowdfundingRepo } from "./CrowdfundingRepo";
import { Crowdfunding } from "./CrowdfundingSchema";

interface CrowdfundingTemporalRepoOptions {
  crowdfundingRepo?: CrowdfundingRepo;
  crowdfundingHistoryRepository?: CrowdfundingHistoryRepositoryStorage;
  changeLogRepository?: ChangeLogRepositoryStorage;
}

/**
 * Temporal Crowdfunding repository - extends CrowdfundingRepo with history tracking
 */
export class CrowdfundingTemporalRepo {
  private crowdfundingRepo: CrowdfundingRepo;
  private crowdfundingHistoryRepository: CrowdfundingHistoryRepositoryStorage;
  private changeLogRepository: ChangeLogRepositoryStorage;

  constructor(options: CrowdfundingTemporalRepoOptions = {}) {
    this.crowdfundingRepo = options.crowdfundingRepo ?? new CrowdfundingRepo();
    this.crowdfundingHistoryRepository =
      options.crowdfundingHistoryRepository ??
      globalServiceRegistry.get(CROWDFUNDING_HISTORY_REPOSITORY_TOKEN);
    this.changeLogRepository =
      options.changeLogRepository ?? globalServiceRegistry.get(CHANGE_LOG_REPOSITORY_TOKEN);
  }

  /**
   * Save a crowdfunding entity with history tracking.
   *
   * When `options.skipMutableUpdate` is true, append a closed-immediately
   * `CrowdfundingHistory` snapshot (valid_from === valid_to) capturing what
   * this filing said and skip both the mutable-row write and ChangeLog
   * emission — used when replaying an older filing that must not regress
   * the current state but should still be visible in the time series.
   */
  async saveCrowdfundingWithHistory(
    crowdfunding: Crowdfunding,
    changeSource: string,
    options?: { skipMutableUpdate?: boolean } | undefined,
    batchId?: string
  ): Promise<void> {
    const changeDate = new Date().toISOString();

    if (options?.skipMutableUpdate === true) {
      // Snapshot the older filing as a closed history row; do not touch the
      // mutable row, do not emit a ChangeLog entry.
      const history: CrowdfundingHistory = {
        ...crowdfunding,
        valid_from: changeDate,
        valid_to: changeDate,
        change_source: changeSource,
        change_date: changeDate,
      };
      await this.crowdfundingHistoryRepository.put(history);
      return;
    }

    const existingCrowdfunding = await this.crowdfundingRepo.getCrowdfunding(
      crowdfunding.cik,
      crowdfunding.file_number
    );

    // If entity exists, create history record for the old version
    if (existingCrowdfunding) {
      const changes = this.detectChanges(existingCrowdfunding, crowdfunding);

      if (changes.length > 0) {
        // Close the current history record
        const currentHistory = await this.getCurrentCrowdfundingHistory(
          crowdfunding.cik,
          crowdfunding.file_number
        );
        if (currentHistory) {
          currentHistory.valid_to = changeDate;
          await this.crowdfundingHistoryRepository.put(currentHistory);
        }

        // Create new history record
        const history: CrowdfundingHistory = {
          ...crowdfunding,
          valid_from: changeDate,
          valid_to: null,
          change_source: changeSource,
          change_date: changeDate,
        };
        await this.crowdfundingHistoryRepository.put(history);

        // Log individual field changes
        for (const change of changes) {
          const changeLog: ChangeLog = {
            change_id: crypto.randomUUID(),
            entity_type: "crowdfunding",
            entity_id: `${crowdfunding.cik}:${crowdfunding.file_number}`,
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
      const history: CrowdfundingHistory = {
        ...crowdfunding,
        valid_from: changeDate,
        valid_to: null,
        change_source: changeSource,
        change_date: changeDate,
      };
      await this.crowdfundingHistoryRepository.put(history);

      // Log creation
      const changeLog: ChangeLog = {
        change_id: crypto.randomUUID(),
        entity_type: "crowdfunding",
        entity_id: `${crowdfunding.cik}:${crowdfunding.file_number}`,
        field_name: "*",
        old_value: null,
        new_value: JSON.stringify(crowdfunding),
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
    await this.crowdfundingRepo.saveCrowdfunding(crowdfunding);
  }

  /**
   * Get crowdfunding entity at a specific point in time
   */
  async getCrowdfundingAtTime(
    cik: number,
    fileNumber: string,
    timestamp: Date
  ): Promise<Crowdfunding | undefined> {
    const history = await this.crowdfundingHistoryRepository.query({
      cik,
      file_number: fileNumber,
    });

    if (!history || history.length === 0) {
      return undefined;
    }

    // Find the record(s) valid at the given timestamp. A normal interval is
    // [valid_from, valid_to) — strict on the right so a row that closes at
    // `t` does not also match at `t`. A stale-replay snapshot is
    // closed-immediately (valid_from === valid_to): without a half-open
    // exception it would match at no timestamp, leaving the row write-only.
    // For those rows we widen to a single-point match at valid_from. If a
    // dominant (non-closed-immediately) row also matches at the same
    // instant, prefer the dominant row — the stale-replay snapshot stays
    // discoverable via getCrowdfundingHistory.
    const timestampStr = timestamp.toISOString();
    const matches = history.filter((record) => {
      const isAfterStart = record.valid_from <= timestampStr;
      const isClosedImmediately =
        record.valid_to !== null && record.valid_to === record.valid_from;
      const isBeforeEnd = isClosedImmediately
        ? record.valid_to! >= timestampStr
        : !record.valid_to || record.valid_to > timestampStr;
      return isAfterStart && isBeforeEnd;
    });

    // Deterministic tie-break: when multiple closed-immediately stale-replay
    // snapshots share `valid_from === valid_to` at the same instant, the
    // backend's natural row order is not portable (SQLite usually preserves
    // insertion order; Postgres does not). Sort by recency so the most
    // recently recorded snapshot wins, with `valid_from` as a stable
    // secondary key. The dominant-row find below still wins precedence.
    matches.sort((a, b) => {
      if (a.change_date !== b.change_date) return b.change_date.localeCompare(a.change_date);
      return b.valid_from.localeCompare(a.valid_from);
    });

    const dominant = matches.find((r) => r.valid_to === null || r.valid_to !== r.valid_from);
    const validRecord = dominant ?? matches[0];

    if (validRecord) {
      const { change_source, change_date, valid_from, valid_to, ...crowdfunding } = validRecord;
      return crowdfunding as Crowdfunding;
    }

    return undefined;
  }

  /**
   * Get crowdfunding history
   */
  async getCrowdfundingHistory(cik: number, fileNumber: string): Promise<CrowdfundingHistory[]> {
    const history = await this.crowdfundingHistoryRepository.query({
      cik,
      file_number: fileNumber,
    });
    return (
      history?.sort(
        (a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime()
      ) || []
    );
  }

  /**
   * Get changes for a crowdfunding entity
   */
  async getCrowdfundingChanges(cik: number, fileNumber: string): Promise<ChangeLog[]> {
    const changes = await this.changeLogRepository.query({
      entity_type: "crowdfunding",
      entity_id: `${cik}:${fileNumber}`,
    });
    return (
      changes?.sort(
        (a, b) => new Date(b.change_date).getTime() - new Date(a.change_date).getTime()
      ) || []
    );
  }

  /**
   * Get current crowdfunding history record
   */
  private async getCurrentCrowdfundingHistory(
    cik: number,
    fileNumber: string
  ): Promise<CrowdfundingHistory | undefined> {
    const history = await this.crowdfundingHistoryRepository.query({
      cik,
      file_number: fileNumber,
      valid_to: null,
    });
    return history?.[0];
  }

  /**
   * Detect changes between two crowdfunding entities
   */
  private detectChanges(
    oldCrowdfunding: Crowdfunding,
    newCrowdfunding: Crowdfunding
  ): Array<{
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }> {
    const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
    const fields: (keyof Crowdfunding)[] = [
      "name",
      "legal_status",
      "state_jurisdiction",
      "date_incorporation",
      "url",
      "portal_cik",
      "status",
      "progress_update",
      "nature_of_amendment",
    ];

    for (const field of fields) {
      if (oldCrowdfunding[field] !== newCrowdfunding[field]) {
        changes.push({
          field,
          oldValue: oldCrowdfunding[field]?.toString() ?? null,
          newValue: newCrowdfunding[field]?.toString() ?? null,
        });
      }
    }

    return changes;
  }

  /**
   * Delegate standard crowdfunding operations to CrowdfundingRepo
   */
  async getCrowdfunding(cik: number, fileNumber: string): Promise<Crowdfunding | undefined> {
    return this.crowdfundingRepo.getCrowdfunding(cik, fileNumber);
  }

  async searchCrowdfunding(criteria: Partial<Crowdfunding>): Promise<Crowdfunding[]> {
    return this.crowdfundingRepo.searchCrowdfunding(criteria);
  }

  async getAllCrowdfunding(): Promise<Crowdfunding[]> {
    return this.crowdfundingRepo.getAllCrowdfunding();
  }
}
