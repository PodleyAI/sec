/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import {
  SPAC_SPONSOR_LINK_REPOSITORY_TOKEN,
  type SpacSponsorLink,
  type SpacSponsorLinkRepositoryStorage,
} from "./SpacSponsorLinkSchema";

export class SpacSponsorLinkRepo {
  private repo: SpacSponsorLinkRepositoryStorage;

  constructor(repo?: SpacSponsorLinkRepositoryStorage) {
    this.repo = repo ?? globalServiceRegistry.get(SPAC_SPONSOR_LINK_REPOSITORY_TOKEN);
  }

  async save(row: SpacSponsorLink): Promise<void> {
    await this.repo.put(row);
  }

  async clear(accession_number: string): Promise<void> {
    const rows = (await this.repo.query({ accession_number })) ?? [];
    for (const r of rows) {
      await this.repo.delete({
        accession_number,
        extractor_id: r.extractor_id,
        observation_index: r.observation_index,
      });
    }
  }

  async listIssuerCiksForFamily(sponsor_family_id: string): Promise<number[]> {
    const rows = (await this.repo.query({ sponsor_family_id })) ?? [];
    return [...new Set(rows.map((r) => r.issuer_cik))];
  }

  /**
   * Pass-through to the underlying tabular storage's COUNT path. Callers must
   * prefer this over `(await ...).length` at scale.
   */
  async count(criteria?: SearchCriteria<SpacSponsorLink>): Promise<number> {
    return await this.repo.count(criteria);
  }

  /**
   * Purge the sponsor→family facts a resolver version produced. The row key
   * excludes `resolver_version`, so a filing re-extracted under a newer version
   * has already had its row overwritten in place; what remains at
   * `resolver_version` is exactly the set of filings still carrying that
   * version's attribution. Deleting them is what keeps the tier consistent when
   * the canonical family rows at that version go away with it.
   */
  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version })) ?? [];
    for (const r of rows) {
      await this.repo.delete({
        accession_number: r.accession_number,
        extractor_id: r.extractor_id,
        observation_index: r.observation_index,
      });
    }
    return rows.length;
  }
}
