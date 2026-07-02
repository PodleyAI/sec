/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  FAMILY_DESCRIPTION_REPOSITORY_TOKEN,
  type FamilyDescription,
  type FamilyDescriptionKind,
  type FamilyDescriptionRepositoryStorage,
} from "./FamilyDescriptionSchema";

/**
 * Get/set the editorial description for a sponsor / underwriter family, keyed by
 * `(family_kind, normalized_name)`. Callers pass the SAME normalized name the
 * resolvers use so the description lines up with the resolved family.
 */
export class FamilyDescriptionRepo {
  private readonly repo: FamilyDescriptionRepositoryStorage;

  constructor(repo?: FamilyDescriptionRepositoryStorage) {
    this.repo = repo ?? globalServiceRegistry.get(FAMILY_DESCRIPTION_REPOSITORY_TOKEN);
  }

  async setDescription(
    family_kind: FamilyDescriptionKind,
    normalized_name: string,
    description: string
  ): Promise<void> {
    await this.repo.put({
      family_kind,
      normalized_name,
      description,
      updated_at: new Date().toISOString(),
    });
  }

  async getDescription(
    family_kind: FamilyDescriptionKind,
    normalized_name: string
  ): Promise<string | null> {
    const row = await this.repo.get({ family_kind, normalized_name });
    return row?.description ?? null;
  }

  async remove(family_kind: FamilyDescriptionKind, normalized_name: string): Promise<void> {
    await this.repo.delete({ family_kind, normalized_name });
  }

  async listByKind(family_kind: FamilyDescriptionKind): Promise<FamilyDescription[]> {
    return (await this.repo.query({ family_kind })) ?? [];
  }
}
