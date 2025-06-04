//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken, globalServiceRegistry } from "@podley/util";
import { Static } from "@sinclair/typebox";
import { normalizePerson, PersonImport } from "./PersonNormalization";
import {
  PersonsEntityJunctionSchema,
  PersonSchema,
  PersonsAddressJunctionSchema,
  PersonPhoneJunctionSchema,
} from "./PersonSchema";

/**
 * Person schema
 */
export type Person = Static<typeof PersonSchema>;
export const PersonPrimaryKeyNames = ["person_hash_id"] as const;
export type PersonRepositoryStorage = TabularRepository<
  typeof PersonSchema,
  typeof PersonPrimaryKeyNames
>;
export const PERSON_REPOSITORY_TOKEN = createServiceToken<PersonRepositoryStorage>(
  "sec.storage.personRepository"
);

/**
 * Person-entity junction schema
 */
export const PersonEntityJunctionPrimaryKeyNames = [
  "person_hash_id",
  "relation_name",
  "cik",
] as const;
export type PersonEntityJunctionRepositoryStorage = TabularRepository<
  typeof PersonsEntityJunctionSchema,
  typeof PersonEntityJunctionPrimaryKeyNames
>;
export const PERSON_ENTITY_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<PersonEntityJunctionRepositoryStorage>(
    "sec.storage.personEntityJunctionRepository"
  );

/**
 * Person-address junction schema
 */
export const PersonAddressJunctionPrimaryKeyNames = [
  "person_hash_id",
  "relation_name",
  "address_hash_id",
] as const;
export type PersonAddressJunctionRepositoryStorage = TabularRepository<
  typeof PersonsAddressJunctionSchema,
  typeof PersonAddressJunctionPrimaryKeyNames
>;
export const PERSON_ADDRESS_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<PersonAddressJunctionRepositoryStorage>(
    "sec.storage.personAddressJunctionRepository"
  );

/**
 * Person-phone junction schema
 */
export const PersonPhoneJunctionPrimaryKeyNames = [
  "person_hash_id",
  "relation_name",
  "international_number",
] as const;
export type PersonPhoneJunctionRepositoryStorage = TabularRepository<
  typeof PersonPhoneJunctionSchema,
  typeof PersonPhoneJunctionPrimaryKeyNames
>;
export const PERSON_PHONE_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<PersonPhoneJunctionRepositoryStorage>(
    "sec.storage.personPhoneJunctionRepository"
  );

// Options for the PersonRepo
interface PersonRepoOptions {
  personRepository?: PersonRepositoryStorage;
  personEntityJunctionRepository?: PersonEntityJunctionRepositoryStorage;
  personAddressJunctionRepository?: PersonAddressJunctionRepositoryStorage;
  personPhoneJunctionRepository?: PersonPhoneJunctionRepositoryStorage;
}

/**
 * Person repository
 */
export class PersonRepo implements PersonRepoOptions {
  personRepository: PersonRepositoryStorage;
  personEntityJunctionRepository: PersonEntityJunctionRepositoryStorage;
  personAddressJunctionRepository: PersonAddressJunctionRepositoryStorage;
  personPhoneJunctionRepository: PersonPhoneJunctionRepositoryStorage;

  constructor(options: PersonRepoOptions = {}) {
    this.personRepository =
      options.personRepository ?? globalServiceRegistry.get(PERSON_REPOSITORY_TOKEN);

    this.personEntityJunctionRepository =
      options.personEntityJunctionRepository ??
      globalServiceRegistry.get(PERSON_ENTITY_JUNCTION_REPOSITORY_TOKEN);

    this.personAddressJunctionRepository =
      options.personAddressJunctionRepository ??
      globalServiceRegistry.get(PERSON_ADDRESS_JUNCTION_REPOSITORY_TOKEN);

    this.personPhoneJunctionRepository =
      options.personPhoneJunctionRepository ??
      globalServiceRegistry.get(PERSON_PHONE_JUNCTION_REPOSITORY_TOKEN);
  }

  async getPerson(personHashId: string): Promise<Person | undefined> {
    return await this.personRepository.get({ person_hash_id: personHashId });
  }

  async savePerson(person: PersonImport): Promise<Person> {
    const normalizedPerson = normalizePerson(person);
    if (!normalizedPerson) {
      throw new Error(`Unable to clean and normalize the provided person: ${person}`);
    }
    await this.personRepository.put(normalizedPerson);
    return normalizedPerson;
  }

  async saveRelatedEntity(
    person_hash_id: string,
    relation_name: string,
    cik: number,
    titles: string[]
  ): Promise<void> {
    await this.personEntityJunctionRepository.put({
      person_hash_id,
      relation_name,
      cik,
      titles,
    });
  }

  async saveRelatedAddress(
    person_hash_id: string,
    relation_name: string,
    address_hash_id: string
  ): Promise<void> {
    await this.personAddressJunctionRepository.put({
      person_hash_id,
      relation_name,
      address_hash_id,
    });
  }

  async saveRelatedPhone(
    international_number: string,
    relation_name: string,
    person_hash_id: string
  ): Promise<void> {
    await this.personPhoneJunctionRepository.put({
      international_number,
      relation_name,
      person_hash_id,
    });
  }

  async savePersonRelatedEntity(
    person: PersonImport,
    relation_name: string,
    cik: number,
    titles: string[]
  ): Promise<Person> {
    const normalizedPerson = await this.savePerson(person);
    await this.saveRelatedEntity(normalizedPerson.person_hash_id, relation_name, cik, titles);
    return normalizedPerson;
  }

  async getPersonsByEntity(cik: number): Promise<Person[]> {
    const junctions = await this.personEntityJunctionRepository.search({ cik });
    if (!junctions || junctions.length === 0) return [];

    const persons: Person[] = [];
    for (const junction of junctions) {
      const person = await this.getPerson(junction.person_hash_id);
      if (person) {
        persons.push(person);
      }
    }
    return persons;
  }

  async getPersonsByEntityAndRelation(cik: number, relation_name: string): Promise<Person[]> {
    const junctions = await this.personEntityJunctionRepository.search({ cik, relation_name });
    if (!junctions || junctions.length === 0) return [];

    const persons: Person[] = [];
    for (const junction of junctions) {
      const person = await this.getPerson(junction.person_hash_id);
      if (person) {
        persons.push(person);
      }
    }
    return persons;
  }

  async searchPersonsByName(firstName?: string, lastName?: string): Promise<Person[]> {
    const searchCriteria: any = {};
    if (firstName) searchCriteria.first = firstName;
    if (lastName) searchCriteria.last = lastName;

    // If no search criteria provided, return all`
    if (Object.keys(searchCriteria).length === 0) {
      return (await this.personRepository.getAll()) || [];
    }

    return (await this.personRepository.search(searchCriteria)) || [];
  }
}
