//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { globalServiceRegistry } from "@podley/util";
import {
  CompanyImport,
  generateCompanyHash,
  normalizeCompany,
  normalizeCompanyName,
} from "./CompanyNormalization";
import {
  Company,
  COMPANY_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_PHONE_JUNCTION_REPOSITORY_TOKEN,
  COMPANY_PREVIOUS_NAMES_REPOSITORY_TOKEN,
  COMPANY_REPOSITORY_TOKEN,
  CompanyAddressJunctionRepositoryStorage,
  CompanyEntityJunctionRepositoryStorage,
  CompanyPhoneJunctionRepositoryStorage,
  CompanyPreviousNamesRepositoryStorage,
  CompanyRepositoryStorage,
} from "./CompanySchema";

// Options for the CompanyRepo
interface CompanyRepoOptions {
  companyRepository?: CompanyRepositoryStorage;
  companyEntityJunctionRepository?: CompanyEntityJunctionRepositoryStorage;
  companyAddressJunctionRepository?: CompanyAddressJunctionRepositoryStorage;
  companyPhoneJunctionRepository?: CompanyPhoneJunctionRepositoryStorage;
  companyPreviousNamesRepository?: CompanyPreviousNamesRepositoryStorage;
}

/**
 * Company repository
 */
export class CompanyRepo implements CompanyRepoOptions {
  companyRepository: CompanyRepositoryStorage;
  companyEntityJunctionRepository: CompanyEntityJunctionRepositoryStorage;
  companyAddressJunctionRepository: CompanyAddressJunctionRepositoryStorage;
  companyPhoneJunctionRepository: CompanyPhoneJunctionRepositoryStorage;
  companyPreviousNamesRepository: CompanyPreviousNamesRepositoryStorage;

  constructor(options: CompanyRepoOptions = {}) {
    this.companyRepository =
      options.companyRepository ?? globalServiceRegistry.get(COMPANY_REPOSITORY_TOKEN);

    this.companyEntityJunctionRepository =
      options.companyEntityJunctionRepository ??
      globalServiceRegistry.get(COMPANY_ENTITY_JUNCTION_REPOSITORY_TOKEN);

    this.companyAddressJunctionRepository =
      options.companyAddressJunctionRepository ??
      globalServiceRegistry.get(COMPANY_ADDRESS_JUNCTION_REPOSITORY_TOKEN);

    this.companyPhoneJunctionRepository =
      options.companyPhoneJunctionRepository ??
      globalServiceRegistry.get(COMPANY_PHONE_JUNCTION_REPOSITORY_TOKEN);

    this.companyPreviousNamesRepository =
      options.companyPreviousNamesRepository ??
      globalServiceRegistry.get(COMPANY_PREVIOUS_NAMES_REPOSITORY_TOKEN);
  }

  public normalizeCompanyName(companyName: string): string | null {
    return normalizeCompanyName(companyName);
  }

  public companyNameSlug(companyName: string): string | null {
    const normalized = normalizeCompanyName(companyName);
    if (!normalized) {
      return null;
    }
    return generateCompanyHash(normalized);
  }

  public async getCompany(companyHashId: string): Promise<Company | undefined> {
    return await this.companyRepository.get({ company_hash_id: companyHashId });
  }

  public async saveCompany(company: CompanyImport | string): Promise<Company> {
    const normalizedCompany = normalizeCompany(company);
    if (!normalizedCompany) {
      throw new Error(`Unable to clean and normalize the provided company: ${company}`);
    }
    await this.companyRepository.put(normalizedCompany);
    return normalizedCompany;
  }

  public async saveRelatedEntity(
    company_hash_id: string,
    relation_name: string,
    cik: number,
    titles: string[]
  ): Promise<void> {
    await this.companyEntityJunctionRepository.put({
      company_hash_id,
      relation_name,
      cik,
      titles,
    });
  }

  public async saveRelatedAddress(
    company_hash_id: string,
    relation_name: string,
    address_hash_id: string
  ): Promise<void> {
    await this.companyAddressJunctionRepository.put({
      company_hash_id,
      relation_name,
      address_hash_id,
    });
  }

  public async saveRelatedPhone(
    international_number: string,
    relation_name: string,
    company_hash_id: string
  ): Promise<void> {
    await this.companyPhoneJunctionRepository.put({
      international_number,
      relation_name,
      company_hash_id,
    });
  }

  public async savePreviousName(
    company_hash_id: string,
    previous_name: string,
    name_type: "issuer" | "edgar" | "dba" | "other",
    source?: string,
    date_changed?: string
  ): Promise<void> {
    // Skip saving if the previous name is empty/invalid
    if (!previous_name || previous_name.trim() === "" || previous_name.toLowerCase() === "none") {
      return;
    }

    // Check if this previous name already exists
    const existing = await this.companyPreviousNamesRepository.get({
      company_hash_id,
      previous_name,
      name_type,
    });

    if (!existing) {
      await this.companyPreviousNamesRepository.put({
        company_hash_id,
        previous_name,
        name_type,
        source,
        date_changed,
      });
    }
  }

  public async getCompaniesByEntity(cik: number): Promise<Company[]> {
    const junctions = await this.companyEntityJunctionRepository.search({ cik });
    if (!junctions || junctions.length === 0) return [];

    const companies: Company[] = [];
    for (const junction of junctions) {
      const company = await this.getCompany(junction.company_hash_id);
      if (company) {
        companies.push(company);
      }
    }
    return companies;
  }

  public async getCompaniesByEntityAndRelation(
    cik: number,
    relation_name: string
  ): Promise<Company[]> {
    const junctions = await this.companyEntityJunctionRepository.search({ cik, relation_name });
    if (!junctions || junctions.length === 0) return [];

    const companies: Company[] = [];
    for (const junction of junctions) {
      const company = await this.getCompany(junction.company_hash_id);
      if (company) {
        companies.push(company);
      }
    }
    return companies;
  }

  public async searchCompaniesByName(name?: string): Promise<Company[]> {
    const searchCriteria: any = {};
    if (name) searchCriteria.company_name = name;

    // If no search criteria provided, return all
    if (Object.keys(searchCriteria).length === 0) {
      return (await this.companyRepository.getAll()) || [];
    }

    return (await this.companyRepository.search(searchCriteria)) || [];
  }
}
