//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { globalServiceRegistry } from "@podley/util";
import { Entity, ENTITY_REPOSITORY_TOKEN, EntityRepositoryStorage } from "./EntitySchema";
import {
  ENTITY_TICKER_REPOSITORY_TOKEN,
  EntityTicker,
  EntityTickerRepositoryStorage,
} from "./EntityTickerSchema";
import { SIC_CODE_REPOSITORY_TOKEN, SicCode, SicCodeRepositoryStorage } from "./SicCodeSchema";
import { CIK_NAME_REPOSITORY_TOKEN, CikNameRepositoryStorage } from "./CikNameSchema";
import { Filing, FILING_REPOSITORY_TOKEN, FilingRepositoryStorage } from "../filing/FilingSchema";

// Options for the EntityRepo
interface EntityRepoOptions {
  entityRepository?: EntityRepositoryStorage;
  entityTickerRepository?: EntityTickerRepositoryStorage;
  sicCodeRepository?: SicCodeRepositoryStorage;
  cikNameRepository?: CikNameRepositoryStorage;
  filingRepository?: FilingRepositoryStorage;
}

/**
 * Entity repository - handles entities, tickers, SIC codes, and filings
 */
export class EntityRepo implements EntityRepoOptions {
  entityRepository: EntityRepositoryStorage;
  entityTickerRepository: EntityTickerRepositoryStorage;
  sicCodeRepository: SicCodeRepositoryStorage;
  cikNameRepository: CikNameRepositoryStorage;
  filingRepository: FilingRepositoryStorage;

  constructor(options: EntityRepoOptions = {}) {
    this.entityRepository =
      options.entityRepository ?? globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
    this.entityTickerRepository =
      options.entityTickerRepository ?? globalServiceRegistry.get(ENTITY_TICKER_REPOSITORY_TOKEN);
    this.sicCodeRepository =
      options.sicCodeRepository ?? globalServiceRegistry.get(SIC_CODE_REPOSITORY_TOKEN);
    this.cikNameRepository =
      options.cikNameRepository ?? globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN);
    this.filingRepository =
      options.filingRepository ?? globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  }

  // Entity methods
  async getEntity(cik: number): Promise<Entity | undefined> {
    return await this.entityRepository.get({ cik });
  }

  async saveEntity(entity: Entity): Promise<void> {
    await this.entityRepository.put(entity);
    await this.cikNameRepository.put({ cik: entity.cik, name: entity.name });
  }

  async saveCikName(cik: number, name: string): Promise<void> {
    await this.cikNameRepository.put({ cik, name });
  }

  async getEntityNameByCik(cik: number): Promise<string | undefined> {
    const cikName = await this.cikNameRepository.get({ cik });
    return cikName?.name || undefined;
  }

  async getCikByEntityName(name: string): Promise<number | undefined> {
    const cikName = await this.cikNameRepository.search({ name });
    return cikName?.[0]?.cik;
  }

  async searchEntities(criteria: Partial<Entity>): Promise<Entity[]> {
    return (await this.entityRepository.search(criteria)) || [];
  }

  async getAllEntities(): Promise<Entity[]> {
    return (await this.entityRepository.getAll()) || [];
  }

  // Entity Ticker methods
  async getEntityTickers(cik: number): Promise<EntityTicker[]> {
    return (await this.entityTickerRepository.search({ cik })) || [];
  }

  async getEntityTicker(
    cik: number,
    ticker: string,
    exchange: string
  ): Promise<EntityTicker | undefined> {
    return await this.entityTickerRepository.get({ cik, ticker, exchange });
  }

  async saveEntityTicker(entityTicker: EntityTicker): Promise<void> {
    await this.entityTickerRepository.put(entityTicker);
  }

  async searchEntityTickers(criteria: Partial<EntityTicker>): Promise<EntityTicker[]> {
    return (await this.entityTickerRepository.search(criteria)) || [];
  }

  async getAllEntityTickers(): Promise<EntityTicker[]> {
    return (await this.entityTickerRepository.getAll()) || [];
  }

  // SIC Code methods
  async getSicCode(sic: number): Promise<SicCode | undefined> {
    return await this.sicCodeRepository.get({ sic });
  }

  async saveSicCode(sic: number, description: string): Promise<void> {
    await this.sicCodeRepository.put({ sic, description });
  }

  async searchSicCodes(criteria: Partial<SicCode>): Promise<SicCode[]> {
    return (await this.sicCodeRepository.search(criteria)) || [];
  }

  async getAllSicCodes(): Promise<SicCode[]> {
    return (await this.sicCodeRepository.getAll()) || [];
  }

  // Filing methods
  async getFiling(cik: number, accessionNumber: string): Promise<Filing | undefined> {
    return await this.filingRepository.get({ cik, accession_number: accessionNumber });
  }

  async saveFiling(filing: Filing): Promise<void> {
    await this.filingRepository.put(filing);
  }

  async getFilings(cik: number): Promise<Filing[]> {
    return (await this.filingRepository.search({ cik })) || [];
  }

  async getFilingsByForm(cik: number, form: string): Promise<Filing[]> {
    return (await this.filingRepository.search({ cik, form })) || [];
  }

  async searchFilings(criteria: Partial<Filing>): Promise<Filing[]> {
    return (await this.filingRepository.search(criteria)) || [];
  }

  async getAllFilings(): Promise<Filing[]> {
    return (await this.filingRepository.getAll()) || [];
  }

  // Convenience methods
  async getEntityWithTickers(
    cik: number
  ): Promise<{ entity: Entity | undefined; tickers: EntityTicker[] }> {
    const [entity, tickers] = await Promise.all([this.getEntity(cik), this.getEntityTickers(cik)]);
    return { entity, tickers };
  }

  async getEntityWithSicDescription(
    cik: number
  ): Promise<{ entity: Entity | undefined; sicDescription: string | null }> {
    const entity = await this.getEntity(cik);
    let sicDescription: string | null = null;

    if (entity?.sic) {
      const sicCode = await this.getSicCode(entity.sic);
      sicDescription = sicCode?.description || null;
    }

    return { entity, sicDescription };
  }

  async getEntityWithFilings(
    cik: number
  ): Promise<{ entity: Entity | undefined; filings: Filing[] }> {
    const [entity, filings] = await Promise.all([this.getEntity(cik), this.getFilings(cik)]);
    return { entity, filings };
  }

  async getEntityWithRecentFilings(
    cik: number,
    limit: number = 10
  ): Promise<{ entity: Entity | undefined; filings: Filing[] }> {
    const entity = await this.getEntity(cik);
    const allFilings = await this.getFilings(cik);

    // Sort by filing date (most recent first) and limit results
    const recentFilings = allFilings
      .sort((a, b) => new Date(b.filing_date).getTime() - new Date(a.filing_date).getTime())
      .slice(0, limit);

    return { entity, filings: recentFilings };
  }
}
