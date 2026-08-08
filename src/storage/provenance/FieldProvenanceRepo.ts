/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  FIELD_PROVENANCE_REPOSITORY_TOKEN,
  type FieldProvenance,
  type FieldProvenanceRepositoryStorage,
} from "./FieldProvenanceSchema";

/** A single field's citation, before the row key and timestamp are stamped on. */
export interface FieldCitation {
  readonly field_name: string;
  readonly confidence: number | null;
  readonly source_span: string | null;
  readonly method: "model" | "anchored";
}

export class FieldProvenanceRepo {
  private readonly storage: FieldProvenanceRepositoryStorage;

  constructor(storage?: FieldProvenanceRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(FIELD_PROVENANCE_REPOSITORY_TOKEN);
  }

  async save(row: Omit<FieldProvenance, "created_at">): Promise<void> {
    await this.storage.put({ ...row, created_at: new Date().toISOString() } as FieldProvenance);
  }

  /**
   * Records one citation per field for a single extracted row.
   *
   * Fields whose value is null are skipped: there is nothing to cite, and a row
   * asserting provenance for an absent value would be noise in the one table
   * whose entire job is to be trustworthy.
   */
  async saveForRow(args: {
    readonly extractor_id: string;
    readonly accession_number: string;
    readonly table_name: string;
    readonly row_key?: string;
    readonly model_id: string | null;
    readonly prompt_version: string | null;
    readonly citations: readonly FieldCitation[];
  }): Promise<number> {
    let wrote = 0;
    for (const c of args.citations) {
      if (c.source_span === null) continue;
      await this.save({
        extractor_id: args.extractor_id,
        accession_number: args.accession_number,
        table_name: args.table_name,
        row_key: args.row_key ?? "",
        field_name: c.field_name,
        confidence: c.confidence,
        source_span: c.source_span,
        method: c.method,
        model_id: args.model_id,
        prompt_version: args.prompt_version,
      });
      wrote++;
    }
    return wrote;
  }

  async listByAccession(accession_number: string): Promise<FieldProvenance[]> {
    return (await this.storage.query({ accession_number })) ?? [];
  }

  /**
   * Drops every citation for one filing+table, so a re-extraction replaces
   * rather than accumulates — the same contract the value tables' `clear()`
   * methods provide.
   */
  async clear(accession_number: string, table_name?: string): Promise<void> {
    const rows = await this.listByAccession(accession_number);
    for (const r of rows) {
      if (table_name !== undefined && r.table_name !== table_name) continue;
      await this.storage.delete({
        extractor_id: r.extractor_id,
        accession_number: r.accession_number,
        table_name: r.table_name,
        row_key: r.row_key,
        field_name: r.field_name,
      });
    }
  }
}
