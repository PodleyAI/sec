import type { Person } from "../../storage/person/PersonSchema";
import { PERSON_REPOSITORY_TOKEN } from "../../storage/person/PersonSchema";
import { globalServiceRegistry } from "@workglow/util";
import type { QueryResult } from "./EntityQuery";

export interface PersonQueryParams {
  readonly search?: string;
  readonly cik?: number;
  readonly role?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export async function queryPersons(params: PersonQueryParams): Promise<QueryResult<Person>> {
  const repo = globalServiceRegistry.get(PERSON_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  let persons: Person[] = (await repo.getAll()) ?? [];

  if (params.search) {
    const searchLower = params.search.toLowerCase();
    persons = persons.filter((p) => {
      const fullName = `${p.first} ${p.last}`.toLowerCase();
      return fullName.includes(searchLower);
    });
  }

  if (params.cik !== undefined) {
    persons = persons.filter((p) => p.cik === params.cik);
  }

  if (params.role) {
    const roleLower = params.role.toLowerCase();
    persons = persons.filter(
      (p) =>
        p.title !== null && p.title !== undefined && p.title.toLowerCase().includes(roleLower)
    );
  }

  const total = persons.length;
  const rows = persons.slice(offset, offset + limit);

  return { rows, total };
}
