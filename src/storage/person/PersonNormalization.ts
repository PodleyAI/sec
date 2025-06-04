//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { parseFullName } from "@sroussey/parse-full-name";
import { Person } from "./PersonSchema";

export type PersonImport = string;

/**
 * Generates a hash ID for a person based on normalized name components
 */
function generatePersonHash(person: Omit<Person, "person_hash_id">): string {
  const hashString = [
    person.first,
    person.middle,
    person.nick,
    person.last,
    person.suffix,
    person.notes,
  ]
    .filter((v) => v !== null && v !== undefined)
    .join("-")
    .toLowerCase();

  return hashString;
}

/**
 * Cleans and normalizes a person import object
 */
export function normalizePerson(importPerson: PersonImport | null): Person | undefined {
  if (!importPerson) return undefined;

  const results = parseFullName(importPerson, { normalize: true, fixCase: 1 });

  if (results.error?.length) {
    // console.error(`Error parsing full name: ${importPerson}, but moving on...`, results.error);
  }

  if (!results.first || !results.last) {
    return undefined;
  }

  const person: Omit<Person, "person_hash_id"> = {
    first: results.first,
    middle: results.middle,
    last: results.last,
    suffix: results.suffix,
    title: results.title,
    nick: results.nick,
    dob: null,
    notes: null,
  };

  const personHashId = generatePersonHash(person);

  return {
    ...person,
    person_hash_id: personHashId,
  };
}
