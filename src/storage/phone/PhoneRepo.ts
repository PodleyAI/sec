//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken, globalServiceRegistry } from "@podley/util";
import { Static } from "@sinclair/typebox";
import { normalizePhone, PhoneImport } from "./PhoneNormalization";
import { PhonesEntityJunctionSchema, PhoneSchema } from "./PhoneSchema";

/**
 * Phone schema
 */
export type Phone = Static<typeof PhoneSchema>;
export const PhonePrimaryKeyNames = ["international_number"] as const;
export type PhoneRepositoryStorage = TabularRepository<
  typeof PhoneSchema,
  typeof PhonePrimaryKeyNames
>;
export const PHONE_REPOSITORY_TOKEN = createServiceToken<PhoneRepositoryStorage>(
  "sec.storage.phoneRepository"
);

/**
 * Phone-entity junction schema
 */
export const PhoneEntityJunctionPrimaryKeyNames = [
  "international_number",
  "relation_name",
  "cik",
] as const;
export type PhoneEntityJunctionRepositoryStorage = TabularRepository<
  typeof PhonesEntityJunctionSchema,
  typeof PhoneEntityJunctionPrimaryKeyNames
>;
export const PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<PhoneEntityJunctionRepositoryStorage>(
    "sec.storage.phoneEntityJunctionRepository"
  );

// Options for the PhoneRepo
interface PhoneRepoOptions {
  phoneRepository?: PhoneRepositoryStorage;
  phoneEntityJunctionRepository?: PhoneEntityJunctionRepositoryStorage;
}

/**
 * Phone repository
 */
export class PhoneRepo implements PhoneRepoOptions {
  phoneRepository: PhoneRepositoryStorage;
  phoneEntityJunctionRepository: PhoneEntityJunctionRepositoryStorage;

  constructor(options: PhoneRepoOptions = {}) {
    this.phoneRepository =
      options.phoneRepository ?? globalServiceRegistry.get(PHONE_REPOSITORY_TOKEN);

    this.phoneEntityJunctionRepository =
      options.phoneEntityJunctionRepository ??
      globalServiceRegistry.get(PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN);
  }

  async getPhone(international_number: string): Promise<Phone | undefined> {
    return await this.phoneRepository.get({ international_number });
  }

  async savePhone(phone: PhoneImport): Promise<Phone> {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      throw new Error(`Unable to clean and normalize the provided phone: ${phone}`);
    }
    await this.phoneRepository.put(normalizedPhone);
    return normalizedPhone;
  }

  async saveRelatedEntity(
    international_number: string,
    relation_name: string,
    cik: number
  ): Promise<void> {
    await this.phoneEntityJunctionRepository.put({
      international_number,
      relation_name,
      cik,
    });
  }

  async savePhoneRelatedEntity(
    phone: PhoneImport,
    relation_name: string,
    cik: number
  ): Promise<Phone> {
    const normalizedPhone = await this.savePhone(phone);
    await this.saveRelatedEntity(normalizedPhone.international_number, relation_name, cik);
    return normalizedPhone;
  }

  async getPhonesByEntity(cik: number): Promise<Phone[]> {
    const junctions = await this.phoneEntityJunctionRepository.search({ cik });
    if (!junctions || junctions.length === 0) return [];

    const phones: Phone[] = [];
    for (const junction of junctions) {
      const phone = await this.getPhone(junction.international_number);
      if (phone) {
        phones.push(phone);
      }
    }
    return phones;
  }

  async getPhonesByEntityAndRelation(cik: number, relation_name: string): Promise<Phone[]> {
    const junctions = await this.phoneEntityJunctionRepository.search({ cik, relation_name });
    if (!junctions || junctions.length === 0) return [];

    const phones: Phone[] = [];
    for (const junction of junctions) {
      const phone = await this.getPhone(junction.international_number);
      if (phone) {
        phones.push(phone);
      }
    }
    return phones;
  }

  async searchPhonesByInternationalNumber(international_number?: string): Promise<Phone[]> {
    const searchCriteria: any = {};
    if (international_number) searchCriteria.international_number = international_number;

    // If no search criteria provided, return all
    if (Object.keys(searchCriteria).length === 0) {
      return (await this.phoneRepository.getAll()) || [];
    }

    return (await this.phoneRepository.search(searchCriteria)) || [];
  }
}
