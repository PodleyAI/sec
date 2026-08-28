/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { normalizeInternationalPhone, normalizePhone, PhoneImport } from "./PhoneNormalization";
import {
  Phone,
  PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  PHONE_REPOSITORY_TOKEN,
  PhoneEntityJunctionRepositoryStorage,
  PhoneRepositoryStorage,
} from "./PhoneSchema";

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
    const normalizedPhone = this.normalize(phone);
    if (!normalizedPhone) {
      // JSON.stringify, not template interpolation — `${phone}` on an object
      // renders the useless "[object Object]".
      throw new Error(`Unable to clean and normalize the provided phone: ${JSON.stringify(phone)}`);
    }
    await this.phoneRepository.put(normalizedPhone);
    return normalizedPhone;
  }

  /**
   * Like {@link savePhone}, but returns undefined instead of throwing when the
   * number cannot be normalized.
   *
   * Mirrors `AddressRepo.saveAddressIfUsable`: where the phone is one contact
   * detail among many, an unparseable number must not discard the enclosing
   * record. EDGAR carries plenty of unusable values in this field.
   */
  async savePhoneIfUsable(phone: PhoneImport): Promise<Phone | undefined> {
    const normalizedPhone = this.normalize(phone);
    if (!normalizedPhone) return undefined;
    await this.phoneRepository.put(normalizedPhone);
    return normalizedPhone;
  }

  /**
   * Normalize through three strategies, in descending order of evidence: the
   * caller's country, then US, then the number's own country code.
   *
   * The international attempt is last because it is the only one that ignores
   * what the caller knows about the filer. It is also the one that recovers
   * the most: measured over a 44k-phone sample of the submissions cache, the
   * first two strategies normalize 95.4% and this one takes it to 98.9% —
   * EDGAR's phone field is free text, and a foreign filer writes the country
   * code into it bare far more often than anything else goes wrong.
   */
  private normalize(phone: PhoneImport): Phone | undefined {
    return (
      normalizePhone(phone) ||
      normalizePhone({ phone_raw: phone.phone_raw, country_code: "US" }) ||
      normalizeInternationalPhone(phone.phone_raw) ||
      undefined
    );
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
    const junctions = await this.phoneEntityJunctionRepository.query({ cik });
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
    const junctions = await this.phoneEntityJunctionRepository.query({ cik, relation_name });
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

    return (await this.phoneRepository.query(searchCriteria)) || [];
  }
}
