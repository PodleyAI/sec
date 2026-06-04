/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  S1_CLASSIFICATION_REPOSITORY_TOKEN,
  type S1Classification,
  type S1ClassificationRepositoryStorage,
} from "./S1ClassificationSchema";

export class S1ClassificationRepo {
  private readonly storage: S1ClassificationRepositoryStorage;

  constructor(storage?: S1ClassificationRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(S1_CLASSIFICATION_REPOSITORY_TOKEN);
  }

  async save(row: S1Classification): Promise<void> {
    await this.storage.put(row);
  }

  async get(extractor_id: string, accession_number: string): Promise<S1Classification | undefined> {
    return this.storage.get({ extractor_id, accession_number });
  }
}
