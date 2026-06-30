/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  OBSERVATION_PROVENANCE_REPOSITORY_TOKEN,
  type ObservationProvenance,
  type ObservationProvenanceRepositoryStorage,
} from "./ObservationProvenanceSchema";

export class ObservationProvenanceRepo {
  private readonly storage: ObservationProvenanceRepositoryStorage;

  constructor(storage?: ObservationProvenanceRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(OBSERVATION_PROVENANCE_REPOSITORY_TOKEN);
  }

  /** Upserts one provenance row; stamps created_at. */
  async save(row: Omit<ObservationProvenance, "created_at">): Promise<void> {
    await this.storage.put({
      ...row,
      created_at: new Date().toISOString(),
    } as ObservationProvenance);
  }

  async get(
    kind: "person" | "company",
    observation_id: number
  ): Promise<ObservationProvenance | undefined> {
    return this.storage.get({ kind, observation_id });
  }

  /** Delete the provenance row for a reaped observation (no-op when absent). */
  async deleteForObservation(kind: "person" | "company", observation_id: number): Promise<void> {
    await this.storage.delete({ kind, observation_id });
  }

  /**
   * Audit helper: every row whose confidence is non-null and below the floor.
   * Scans all rows — not a hot path.
   */
  async listBelowConfidence(floor: number): Promise<ObservationProvenance[]> {
    const all = (await this.storage.getAll()) ?? [];
    return all.filter((r) => r.confidence !== null && r.confidence < floor);
  }
}
