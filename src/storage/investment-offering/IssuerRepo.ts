//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { globalServiceRegistry } from "@podley/util";
import { Issuer, ISSUER_REPOSITORY_TOKEN, IssuerRepositoryStorage } from "./IssuerSchema";

// Options for the IssuerRepo
interface IssuerRepoOptions {
  issuerRepository?: IssuerRepositoryStorage;
}

/**
 * Issuer repository - manages entity-issuer relationships
 */
export class IssuerRepo implements IssuerRepoOptions {
  readonly issuerRepository: IssuerRepositoryStorage;

  constructor(options: IssuerRepoOptions = {}) {
    this.issuerRepository =
      options.issuerRepository ?? globalServiceRegistry.get(ISSUER_REPOSITORY_TOKEN);
  }

  async getIssuer(cik: number, issuer_cik: number): Promise<Issuer | undefined> {
    return await this.issuerRepository.get({ cik, issuer_cik });
  }

  async saveIssuer(issuer: Issuer): Promise<Issuer> {
    await this.issuerRepository.put(issuer);
    return issuer;
  }

  /**
   * Get all issuers for a given entity CIK
   */
  async getIssuersByCik(cik: number): Promise<Issuer[]> {
    return (await this.issuerRepository.search({ cik })) || [];
  }

  /**
   * Get all entities that have a specific issuer
   */
  async getEntitiesByIssuerCik(issuer_cik: number): Promise<Issuer[]> {
    return (await this.issuerRepository.search({ issuer_cik })) || [];
  }

  /**
   * Get primary issuers for a given entity CIK
   */
  async getPrimaryIssuersByCik(cik: number): Promise<Issuer[]> {
    return (await this.issuerRepository.search({ cik, is_primary: true })) || [];
  }

  /**
   * Get all entities where the given issuer CIK is the primary issuer
   */
  async getEntitiesWithPrimaryIssuer(issuer_cik: number): Promise<Issuer[]> {
    return (await this.issuerRepository.search({ issuer_cik, is_primary: true })) || [];
  }

  /**
   * Get secondary (non-primary) issuers for a given entity CIK
   */
  async getSecondaryIssuersByCik(cik: number): Promise<Issuer[]> {
    return (await this.issuerRepository.search({ cik, is_primary: false })) || [];
  }

  /**
   * Get all entities where the given issuer CIK is a secondary issuer
   */
  async getEntitiesWithSecondaryIssuer(issuer_cik: number): Promise<Issuer[]> {
    return (await this.issuerRepository.search({ issuer_cik, is_primary: false })) || [];
  }

  /**
   * Check if a specific issuer relationship exists
   */
  async hasIssuerRelationship(cik: number, issuer_cik: number): Promise<boolean> {
    const relationship = await this.getIssuer(cik, issuer_cik);
    return relationship !== undefined;
  }

  /**
   * Check if a specific primary issuer relationship exists
   */
  async hasPrimaryIssuerRelationship(cik: number, issuer_cik: number): Promise<boolean> {
    const relationship = await this.getIssuer(cik, issuer_cik);
    return relationship !== undefined && relationship.is_primary === true;
  }

  /**
   * Remove an issuer relationship
   */
  async removeIssuer(cik: number, issuer_cik: number): Promise<boolean> {
    const existing = await this.getIssuer(cik, issuer_cik);
    if (existing) {
      await this.issuerRepository.delete({ cik, issuer_cik });
      return true;
    }
    return false;
  }

  /**
   * Update the primary status of an issuer relationship
   */
  async updateIssuerPrimaryStatus(
    cik: number,
    issuer_cik: number,
    is_primary: boolean
  ): Promise<Issuer | undefined> {
    const existing = await this.getIssuer(cik, issuer_cik);
    if (existing) {
      const updated: Issuer = { ...existing, is_primary };
      await this.saveIssuer(updated);
      return updated;
    }
    return undefined;
  }

  async searchIssuers(searchCriteria: Partial<Issuer>): Promise<Issuer[]> {
    // If no search criteria provided, return all
    if (Object.keys(searchCriteria).length === 0) {
      return (await this.issuerRepository.getAll()) || [];
    }

    return (await this.issuerRepository.search(searchCriteria)) || [];
  }

  async getAllIssuers(): Promise<Issuer[]> {
    return (await this.issuerRepository.getAll()) || [];
  }
}
