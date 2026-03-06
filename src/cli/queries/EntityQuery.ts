import type { Entity } from "../../storage/entity/EntitySchema";
import { EntityRepo } from "../../storage/entity/EntityRepo";

export interface EntityQueryParams {
  readonly search?: string;
  readonly cik?: number;
  readonly sic?: number;
  readonly state?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly sort?: string;
}

export interface QueryResult<T> {
  readonly rows: T[];
  readonly total: number;
}

const ENTITY_SORT_KEYS: ReadonlySet<string> = new Set([
  "cik",
  "name",
  "type",
  "sic",
  "ein",
  "description",
  "website",
  "investor_website",
  "category",
  "fiscal_year",
  "state_incorporation",
  "state_incorporation_desc",
]);

export async function queryEntities(params: EntityQueryParams): Promise<QueryResult<Entity>> {
  const repo = new EntityRepo();
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  let entities: Entity[];

  if (params.cik !== undefined) {
    const entity = await repo.getEntity(params.cik);
    entities = entity ? [entity] : [];
  } else if (
    params.sic !== undefined ||
    params.state !== undefined
  ) {
    const criteria: Partial<Entity> = {};
    if (params.sic !== undefined) criteria.sic = params.sic;
    if (params.state !== undefined) criteria.state_incorporation = params.state;
    entities = await repo.searchEntities(criteria);
  } else {
    entities = await repo.getAllEntities();
  }

  // Apply search filter (partial, case-insensitive name match)
  if (params.search) {
    const searchLower = params.search.toLowerCase();
    entities = entities.filter(
      (e) => e.name !== null && e.name.toLowerCase().includes(searchLower)
    );
  }

  // Apply additional filters when fetched via a broader method
  if (params.cik === undefined && params.sic !== undefined && params.state !== undefined) {
    // searchEntities only takes one set of criteria; both are already applied above
  } else if (params.cik !== undefined) {
    // If we fetched by CIK, also filter by sic/state if provided
    if (params.sic !== undefined) {
      entities = entities.filter((e) => e.sic === params.sic);
    }
    if (params.state !== undefined) {
      entities = entities.filter((e) => e.state_incorporation === params.state);
    }
  }

  // Sort
  if (params.sort) {
    if (!ENTITY_SORT_KEYS.has(params.sort)) {
      throw new Error(
        `Invalid sort field "${params.sort}". Valid fields: ${[...ENTITY_SORT_KEYS].join(", ")}.`
      );
    }
    const sortKey = params.sort as keyof Entity;
    entities.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
      return 0;
    });
  }

  const total = entities.length;
  const rows = entities.slice(offset, offset + limit);

  return { rows, total };
}
