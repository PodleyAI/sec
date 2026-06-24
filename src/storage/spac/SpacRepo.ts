/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { Spac, SpacStatus, SPAC_REPOSITORY_TOKEN, SpacRepositoryStorage } from "./SpacSchema";
import { SpacDeal, SPAC_DEAL_REPOSITORY_TOKEN, SpacDealRepositoryStorage } from "./SpacDealSchema";
import { SpacEvent, SPAC_EVENT_REPOSITORY_TOKEN, SpacEventRepositoryStorage } from "./SpacEventSchema";
import {
  SpacHistory,
  SPAC_HISTORY_REPOSITORY_TOKEN,
  SpacHistoryRepositoryStorage,
} from "./SpacHistorySchema";

interface SpacRepoOptions {
  spacRepository?: SpacRepositoryStorage;
  dealRepository?: SpacDealRepositoryStorage;
  eventRepository?: SpacEventRepositoryStorage;
  historyRepository?: SpacHistoryRepositoryStorage;
}

/** Aggregates the four SPAC tables behind one repository. */
export class SpacRepo {
  readonly spacRepository: SpacRepositoryStorage;
  readonly dealRepository: SpacDealRepositoryStorage;
  readonly eventRepository: SpacEventRepositoryStorage;
  readonly historyRepository: SpacHistoryRepositoryStorage;

  constructor(options: SpacRepoOptions = {}) {
    this.spacRepository = options.spacRepository ?? globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
    this.dealRepository = options.dealRepository ?? globalServiceRegistry.get(SPAC_DEAL_REPOSITORY_TOKEN);
    this.eventRepository =
      options.eventRepository ?? globalServiceRegistry.get(SPAC_EVENT_REPOSITORY_TOKEN);
    this.historyRepository =
      options.historyRepository ?? globalServiceRegistry.get(SPAC_HISTORY_REPOSITORY_TOKEN);
  }

  async getSpac(cik: number): Promise<Spac | undefined> {
    return this.spacRepository.get({ cik });
  }

  async saveSpac(row: Spac): Promise<void> {
    await this.spacRepository.put(row);
  }

  async getSpacsByStatus(status: SpacStatus): Promise<Spac[]> {
    return (await this.spacRepository.query({ status })) || [];
  }

  /** Every spac row, regardless of status. */
  async getAllSpacs(): Promise<Spac[]> {
    return (await this.spacRepository.getAll()) || [];
  }

  async saveDeal(deal: SpacDeal): Promise<void> {
    await this.dealRepository.put(deal);
  }

  async deleteDeal(cik: number, deal_index: number): Promise<void> {
    await this.dealRepository.delete({ cik, deal_index });
  }

  /** Deals for a CIK, ascending by deal_index. */
  async getDeals(cik: number): Promise<SpacDeal[]> {
    const rows = (await this.dealRepository.query({ cik })) || [];
    return rows.sort((a, b) => a.deal_index - b.deal_index);
  }

  async saveEvent(event: SpacEvent): Promise<void> {
    await this.eventRepository.put(event);
  }

  /** Events for a CIK, ascending by event_date then created_at. */
  async getEvents(cik: number): Promise<SpacEvent[]> {
    const rows = (await this.eventRepository.query({ cik })) || [];
    return rows.sort(
      (a, b) =>
        a.event_date.localeCompare(b.event_date) || a.created_at.localeCompare(b.created_at)
    );
  }

  async saveHistory(history: SpacHistory): Promise<void> {
    await this.historyRepository.put(history);
  }

  /** History snapshots for a CIK, ascending by valid_from. */
  async getHistory(cik: number): Promise<SpacHistory[]> {
    const rows = (await this.historyRepository.query({ cik })) || [];
    return rows.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  }
}
