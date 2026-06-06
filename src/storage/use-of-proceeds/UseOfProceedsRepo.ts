/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  USE_OF_PROCEEDS_REPOSITORY_TOKEN,
  type UseOfProceeds,
  type UseOfProceedsRepositoryStorage,
} from "./UseOfProceedsSchema";

export class UseOfProceedsRepo {
  private readonly storage: UseOfProceedsRepositoryStorage;

  constructor(storage?: UseOfProceedsRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(USE_OF_PROCEEDS_REPOSITORY_TOKEN);
  }

  async save(row: UseOfProceeds): Promise<void> {
    await this.storage.put(row);
  }

  async queryByAccession(accession_number: string): Promise<UseOfProceeds[]> {
    return (await this.storage.query({ accession_number })) ?? [];
  }

  async clear(accession_number: string): Promise<void> {
    const rows = await this.queryByAccession(accession_number);
    for (const r of rows) {
      await this.storage.delete({
        extractor_id: r.extractor_id,
        accession_number: r.accession_number,
        line_index: r.line_index,
      });
    }
  }
}
