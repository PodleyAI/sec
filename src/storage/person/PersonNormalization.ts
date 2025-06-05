//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { parseFullName } from "@sroussey/parse-full-name";
import { Person } from "./PersonSchema";

export type PersonImport = {
  name: string;
  cik?: number | null;
  crd?: string | null;
};

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
    .toLowerCase()
    .replaceAll(/[\. ]/g, "-")
    .replaceAll(/--+/g, "-")
    .trim()
    .replace(/^-|-$/g, "");

  return hashString;
}

/**
 * Cleans and normalizes a person import object
 */
export function normalizePerson(importPerson: PersonImport | null): Person | undefined {
  if (!importPerson) return undefined;

  // Extract name, cik, and crd from the object
  const name = importPerson.name;
  const cik = importPerson.cik || null;
  const crd = importPerson.crd || null;

  const cleanPerson = name.replace("/s/", "").trim();

  const results = parseFullName(cleanPerson, { normalize: true, fixCase: 1 });

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
    cik,
    crd,
  };

  const personHashId = generatePersonHash(person);

  return {
    ...person,
    person_hash_id: personHashId,
  };
}
