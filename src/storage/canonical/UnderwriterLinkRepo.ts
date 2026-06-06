/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  UNDERWRITER_LINK_REPOSITORY_TOKEN,
  type UnderwriterLink,
  type UnderwriterLinkRepositoryStorage,
} from "./UnderwriterLinkSchema";

export class UnderwriterLinkRepo {
  private repo: UnderwriterLinkRepositoryStorage;

  constructor(repo?: UnderwriterLinkRepositoryStorage) {
    this.repo = repo ?? globalServiceRegistry.get(UNDERWRITER_LINK_REPOSITORY_TOKEN);
  }

  async save(row: UnderwriterLink): Promise<void> {
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

  async listIssuerCiksForFamily(underwriter_family_id: string): Promise<number[]> {
    const rows = (await this.repo.query({ underwriter_family_id })) ?? [];
    return [...new Set(rows.map((r) => r.issuer_cik))];
  }
}
