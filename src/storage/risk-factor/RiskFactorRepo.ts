/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  RISK_FACTOR_REPOSITORY_TOKEN,
  type RiskFactor,
  type RiskFactorRepositoryStorage,
} from "./RiskFactorSchema";

export class RiskFactorRepo {
  private readonly storage: RiskFactorRepositoryStorage;

  constructor(storage?: RiskFactorRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(RISK_FACTOR_REPOSITORY_TOKEN);
  }

  async save(row: RiskFactor): Promise<void> {
    await this.storage.put(row);
  }

  /** Rows for one filing, in document order. */
  async queryByAccession(accession_number: string): Promise<RiskFactor[]> {
    const rows = (await this.storage.query({ accession_number })) ?? [];
    return [...rows].sort((a, b) => a.risk_index - b.risk_index);
  }

  async clear(accession_number: string): Promise<void> {
    const rows = await this.queryByAccession(accession_number);
    for (const r of rows) {
      await this.storage.delete({
        extractor_id: r.extractor_id,
        accession_number: r.accession_number,
        risk_index: r.risk_index,
      });
    }
  }
}
