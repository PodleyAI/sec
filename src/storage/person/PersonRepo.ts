//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { globalServiceRegistry } from "@podley/util";
import { normalizePerson, PersonImport } from "./PersonNormalization";
import {
  Person,
  PERSON_ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  PERSON_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  PERSON_PHONE_JUNCTION_REPOSITORY_TOKEN,
  PERSON_PREVIOUS_NAMES_REPOSITORY_TOKEN,
  PERSON_REPOSITORY_TOKEN,
  PersonAddressJunctionRepositoryStorage,
  PersonEntityJunctionRepositoryStorage,
  PersonPhoneJunctionRepositoryStorage,
  PersonPreviousNamesRepositoryStorage,
  PersonRepositoryStorage,
} from "./PersonSchema";

// Options for the PersonRepo
interface PersonRepoOptions {
  personRepository?: PersonRepositoryStorage;
  personEntityJunctionRepository?: PersonEntityJunctionRepositoryStorage;
  personAddressJunctionRepository?: PersonAddressJunctionRepositoryStorage;
  personPhoneJunctionRepository?: PersonPhoneJunctionRepositoryStorage;
  personPreviousNamesRepository?: PersonPreviousNamesRepositoryStorage;
}

/**
 * Person repository
 */
export class PersonRepo implements PersonRepoOptions {
  personRepository: PersonRepositoryStorage;
  personEntityJunctionRepository: PersonEntityJunctionRepositoryStorage;
  personAddressJunctionRepository: PersonAddressJunctionRepositoryStorage;
  personPhoneJunctionRepository: PersonPhoneJunctionRepositoryStorage;
  personPreviousNamesRepository: PersonPreviousNamesRepositoryStorage;

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

    this.personPreviousNamesRepository =
      options.personPreviousNamesRepository ??
      globalServiceRegistry.get(PERSON_PREVIOUS_NAMES_REPOSITORY_TOKEN);
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

  async savePreviousName(
    person_hash_id: string,
    previous_name: string,
    name_type: "maiden" | "former" | "alias" | "other",
    source?: string,
    date_changed?: string
  ): Promise<void> {
    // Skip saving if the previous name is empty/invalid
    if (!previous_name || previous_name.trim() === "" || previous_name.toLowerCase() === "none") {
      return;
    }

    // Check if this previous name already exists
    const existing = await this.personPreviousNamesRepository.get({
      person_hash_id,
      previous_name,
      name_type,
    });

    if (!existing) {
      await this.personPreviousNamesRepository.put({
        person_hash_id,
        previous_name,
        name_type,
        source,
        date_changed,
      });
    }
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

    // If no search criteria provided, return all
    if (Object.keys(searchCriteria).length === 0) {
      return (await this.personRepository.getAll()) || [];
    }

    return (await this.personRepository.search(searchCriteria)) || [];
  }
}
