/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { CanonicalPersonRepo } from "../../storage/canonical/CanonicalPersonRepo";
import { PersonRoleRepo } from "../../storage/canonical/PersonRoleRepo";
import type { PersonRole } from "../../storage/canonical/PersonRoleSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import type { QueryResult } from "./EntityQuery";

export interface RoleQueryParams {
  readonly cik: number;
  /** Only open tenures (`end_date` null). */
  readonly current?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/** A role tenure joined with the canonical person's display name. */
export interface PersonRoleRow extends PersonRole {
  readonly person_name: string;
}

/**
 * Dated person↔title tenures at a company, at the active person-resolver
 * version: who holds (or held) which title, since when, and until when.
 * Open tenures sort first, then most recent starts.
 */
export async function queryPersonRoles(
  params: RoleQueryParams
): Promise<QueryResult<PersonRoleRow>> {
  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const slot = await getActiveSlot(versionRegistry, "resolver", "person");
  const resolver_version = slot?.semver ?? "1.0.0";

  const roleRepo = new PersonRoleRepo();
  const personRepo = new CanonicalPersonRepo();
  let roles = await roleRepo.listForCompany(params.cik, resolver_version);
  if (params.current) roles = roles.filter((r) => r.end_date === null);

  const total = roles.length;
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 25;
  const page = roles.slice(offset, offset + limit);

  const ids = [...new Set(page.map((r) => r.canonical_person_id))];
  const people = await Promise.all(ids.map((id) => personRepo.getById(id)));
  const names = new Map(
    ids.map((id, i) => [
      id,
      [people[i]?.display_first, people[i]?.display_last].filter(Boolean).join(" "),
    ])
  );
  const rows: PersonRoleRow[] = page.map((role) => ({
    ...role,
    person_name: names.get(role.canonical_person_id) ?? "",
  }));
  return { rows, total };
}
