import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import { EntityRepo } from "../../storage/entity/EntityRepo";
import type { Entity } from "../../storage/entity/EntitySchema";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { collectPage, streamMatchingRows } from "./_streamMatches";

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
  /**
   * When `totalApprox` is set, `total` is the number of matches counted
   * before the streaming soft cap fired (a lower bound), not the exact
   * dataset cardinality. Pagination UX should render this as a lower
   * bound (e.g. "≥ N") rather than an exact count. Used when streaming
   * substring searches that cannot be pushed down to the database — a
   * truly exact total would require an unbounded full table scan.
   *
   * When `totalApprox` is absent, the stream drained and `total` is the
   * exact match count.
   */
  readonly total: number;
  readonly totalApprox?: {
    /** The match count we got to before stopping (the soft cap). */
    readonly atLeast: number;
  };
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
  // Validate sort up front so we never partially apply a bad call.
  if (params.sort !== undefined && !ENTITY_SORT_KEYS.has(params.sort)) {
    throw new Error(
      `Invalid sort field "${params.sort}". Valid fields: ${[...ENTITY_SORT_KEYS].join(", ")}.`
    );
  }

  const repo = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  // CIK is the primary key — a `get` is always optimal.
  if (params.cik !== undefined) {
    const entityRepo = new EntityRepo();
    const entity = await entityRepo.getEntity(params.cik);
    if (!entity) return { rows: [], total: 0 };
    if (params.sic !== undefined && entity.sic !== params.sic) return { rows: [], total: 0 };
    if (params.state !== undefined && entity.state_incorporation !== params.state) {
      return { rows: [], total: 0 };
    }
    if (params.search) {
      const searchLower = params.search.toLowerCase();
      if (entity.name === null || !entity.name.toLowerCase().includes(searchLower)) {
        return { rows: [], total: 0 };
      }
    }
    return { rows: [entity], total: 1 };
  }

  const criteria: SearchCriteria<Entity> = {};
  if (params.sic !== undefined) (criteria as Partial<Entity>).sic = params.sic;
  if (params.state !== undefined) {
    (criteria as Partial<Entity>).state_incorporation = params.state;
  }
  const hasCriteria = Object.keys(criteria).length > 0;
  const hasSearch = params.search !== undefined && params.search !== "";
  const orderBy = params.sort
    ? [{ column: params.sort as keyof Entity, direction: "ASC" as const }]
    : undefined;

  if (!hasSearch) {
    if (hasCriteria) {
      const total = await repo.count(criteria);
      const rows = (await repo.query(criteria, { orderBy, limit, offset })) ?? [];
      return { rows, total };
    }
    const total = await repo.size();
    if (orderBy === undefined) {
      const rows = (await repo.getOffsetPage(offset, limit)) ?? [];
      return { rows, total };
    }
    // No criteria but caller wants a sort. getAll({orderBy, limit, offset})
    // pushes ORDER BY/LIMIT/OFFSET down to SQL (queryPage is cursor-based
    // and ignores `offset`, which would silently return the first page
    // forever — the previous implementation here had that bug).
    const rows = (await repo.getAll({ orderBy, limit, offset })) ?? [];
    return { rows, total };
  }

  // Substring search — stream matches, counting every one up to the soft
  // cap so `total` is a meaningful lower bound, while retaining only the
  // requested window in memory.
  const searchLower = params.search!.toLowerCase();
  const predicate = (e: Entity): boolean =>
    e.name !== null && e.name.toLowerCase().includes(searchLower);

  const { rows, total, exhausted } = await collectPage(
    streamMatchingRows(repo, criteria, predicate),
    offset,
    limit
  );

  // Sort the collected window only. collectPage preserves stream order and
  // retains just [offset, offset + limit), so this re-orders the page the
  // user sees — it does NOT globally sort the full match set. (A global
  // sort would require buffering every match, which the window-only design
  // deliberately avoids.)
  if (params.sort) {
    const sortKey = params.sort as keyof Entity;
    rows.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
      return 0;
    });
  }

  // totalApprox is the "this number is a lower bound" signal — only
  // emit it when the stream was capped, not when it drained. Its presence
  // (not any field on it) is what marks `total` as approximate.
  return exhausted ? { rows, total } : { rows, total, totalApprox: { atLeast: total } };
}
