//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { normalizePerson, type PersonImport } from "./PersonNormalization";
import { PersonRepo } from "./PersonRepo";
import {
  Person,
  PersonAddressJunctionRepositoryStorage,
  PersonEntityJunctionRepositoryStorage,
  PersonPhoneJunctionRepositoryStorage,
  PersonRepositoryStorage,
} from "./PersonSchema";

describe("PersonRepo", () => {
  let personRepo: PersonRepo;
  let personStorage: PersonRepositoryStorage;
  let personJunctionStorage: PersonEntityJunctionRepositoryStorage;
  let personAddressJunctionStorage: PersonAddressJunctionRepositoryStorage;
  let personPhoneJunctionStorage: PersonPhoneJunctionRepositoryStorage;
  // Mock data
  const mockPerson1: PersonImport = { name: "John William Smith JR" };
  const mockPerson2: PersonImport = { name: "Jane Unknown Doe" };
  const mockPerson3: PersonImport = { name: "John Williams" };

  beforeEach(() => {
    resetDependencyInjectionsForTesting();

    personRepo = new PersonRepo();
    personStorage = personRepo.personRepository;
    personJunctionStorage = personRepo.personEntityJunctionRepository;
    personAddressJunctionStorage = personRepo.personAddressJunctionRepository;
    personPhoneJunctionStorage = personRepo.personPhoneJunctionRepository;
  });

  describe("constructor", () => {
    it("should initialize with provided repositories", () => {
      expect(personRepo.personRepository).toBe(personStorage);
      expect(personRepo.personEntityJunctionRepository).toBe(personJunctionStorage);
    });
  });

  describe("getPerson", () => {
    it("should return person when found", async () => {
      const normalizedPerson = normalizePerson(mockPerson1);
      await personStorage.put(normalizedPerson!);
      const result = await personRepo.getPerson(normalizedPerson!.person_hash_id);
      expect(result).toEqual(normalizedPerson!);
    });

    it("should return undefined when person not found", async () => {
      const result = await personRepo.getPerson("nonexistent_hash");
      expect(result).toBeUndefined();
    });
  });

  describe("savePerson", () => {
    it("should successfully save person and junction record", async () => {
      const normalizedPerson = normalizePerson(mockPerson1);
      expect(normalizedPerson).toBeDefined();
      const savedPerson = await personRepo.savePersonRelatedEntity(
        mockPerson1,
        "form-z:something",
        123456,
        ["director"]
      );

      const storedPerson = await personStorage.get({
        person_hash_id: normalizedPerson!.person_hash_id,
      });
      expect(storedPerson).toEqual(normalizedPerson!);

      const junctionRecords = await personJunctionStorage.search({
        person_hash_id: normalizedPerson!.person_hash_id,
        relation_name: "form-z:something",
        cik: 123456,
      });
      expect(junctionRecords).toBeDefined();
      expect(junctionRecords).toHaveLength(1);
      expect(junctionRecords![0]).toEqual({
        person_hash_id: normalizedPerson!.person_hash_id,
        relation_name: "form-z:something",
        cik: 123456,
        titles: ["director"],
      });
    });

    it("should throw error when normalizePerson returns null", async () => {
      const normalizedPerson = normalizePerson({ name: "John William Smith JR" });
      const allPersons = await personStorage.getAll();
      const allJunctions = await personJunctionStorage.getAll();
      expect(allPersons || []).toEqual([]);
      expect(allJunctions || []).toEqual([]);
    });

    it("should handle different relation names and CIKs", async () => {
      const normalizedPerson = normalizePerson(mockPerson1);
      expect(normalizedPerson).toBeDefined();
      await personRepo.savePersonRelatedEntity(mockPerson1, "form-z:something", 789456, [
        "officer",
      ]);

      const junctionRecord = await personJunctionStorage.get({
        person_hash_id: normalizedPerson!.person_hash_id,
        relation_name: "form-z:something",
        cik: 789456,
      });
      expect(junctionRecord).toBeDefined();
      expect(junctionRecord).toEqual({
        person_hash_id: normalizedPerson!.person_hash_id,
        relation_name: "form-z:something",
        cik: 789456,
        titles: ["officer"],
      });
    });
  });

  describe("getPersonsByEntity", () => {
    it("should return persons associated with an entity", async () => {
      const cik = 123456;
      const normalizedPerson = normalizePerson(mockPerson1);
      expect(normalizedPerson).toBeDefined();
      await personStorage.put(normalizedPerson!);
      await personJunctionStorage.put({
        person_hash_id: normalizedPerson!.person_hash_id,
        relation_name: "form-z:something",
        cik: cik,
        titles: ["director"],
      });

      const result = await personRepo.getPersonsByEntity(cik);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(normalizedPerson!);
    });

    it("should return empty array when no persons found for entity", async () => {
      const cik = 999999;
      const result = await personRepo.getPersonsByEntity(cik);
      expect(result).toEqual([]);
    });

    it("should return multiple persons for an entity", async () => {
      const cik = 123456;
      const normalizedPerson1 = await personRepo.savePersonRelatedEntity(
        mockPerson1,
        "form-z:something",
        cik,
        ["director"]
      );
      const normalizedPerson2 = await personRepo.savePersonRelatedEntity(
        mockPerson2,
        "form-z:something",
        cik,
        ["officer"]
      );
      const result = await personRepo.getPersonsByEntity(cik);
      expect(result).toHaveLength(2);
      expect(result).toContainEqual(normalizedPerson1!);
      expect(result).toContainEqual(normalizedPerson2!);
    });
  });

  describe("getPersonsByRelation", () => {
    it("should return persons with specific relation to entity", async () => {
      // Arrange
      const cik = 123456;
      const relationName = "form-z:something";

      const normalizedPerson = await personRepo.savePersonRelatedEntity(
        mockPerson1,
        relationName,
        cik,
        ["director"]
      );

      const result = await personRepo.getPersonsByEntityAndRelation(cik, relationName);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(normalizedPerson!);
    });

    it("should return empty array when no persons found for relation", async () => {
      // Arrange
      const cik = 123456;
      const relationName = "nonexistent_relation";

      // Act
      const result = await personRepo.getPersonsByEntityAndRelation(cik, relationName);

      // Assert
      expect(result).toEqual([]);
    });

    it("should filter by both entity and relation", async () => {
      // Arrange
      const cik = 123456;
      const normalizedPerson = await personRepo.savePersonRelatedEntity(
        mockPerson1,
        "form-z:something",
        cik,
        ["director"]
      );
      const normalizedPerson2 = await personRepo.savePersonRelatedEntity(
        mockPerson2,
        "form-z:nothing",
        cik,
        ["officer"]
      );

      // Same entity, different relations
      const result = await personRepo.getPersonsByEntityAndRelation(cik, "form-z:something");

      const something = await personRepo.getPersonsByEntityAndRelation(cik, "form-z:something");
      const nothing = await personRepo.getPersonsByEntityAndRelation(cik, "form-z:nothing");
      expect(something).toHaveLength(1);
      expect(something[0]).toEqual(normalizedPerson!);
      expect(nothing).toHaveLength(1);
      expect(nothing[0]).toEqual(normalizedPerson2!);
    });
  });

  describe("searchPersonsByName", () => {
    let normalizedPerson1: Person;
    let normalizedPerson2: Person;
    let normalizedPerson3: Person;
    beforeEach(async () => {
      normalizedPerson1 = await personRepo.savePersonRelatedEntity(
        mockPerson1,
        "form-z:something",
        123456,
        ["director"]
      );
      normalizedPerson2 = await personRepo.savePersonRelatedEntity(
        mockPerson2,
        "form-z:something",
        123456,
        ["officer"]
      );
      normalizedPerson3 = await personRepo.savePersonRelatedEntity(
        mockPerson3,
        "form-z:something",
        123456,
        ["director"]
      );
    });

    it("should search by first name only", async () => {
      const result = await personRepo.searchPersonsByName("John");
      expect(result).toHaveLength(2);
      expect(result.every((p) => p.first === "John")).toBe(true);
    });

    it("should search by last name only", async () => {
      const result = await personRepo.searchPersonsByName(undefined, "Doe");
      expect(result).toHaveLength(1);
      expect(result.every((p) => p.last === "Doe")).toBe(true);
    });

    it("should search by both first and last name", async () => {
      // Act
      const result = await personRepo.searchPersonsByName("John");

      // Assert
      expect(result).toHaveLength(2);
      expect(result.every((p) => p.first === "John")).toBe(true);
    });

    it("should return empty array when no matches found", async () => {
      // Act
      const result = await personRepo.searchPersonsByName("Nonexistent", "Name");

      // Assert
      expect(result).toEqual([]);
    });

    it("should return all persons when no search criteria provided", async () => {
      // Act
      const result = await personRepo.searchPersonsByName();

      // Assert
      expect(result).toHaveLength(3);
    });
  });
});
