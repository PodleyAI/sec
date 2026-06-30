/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  FORM_8K_EVENT_REPOSITORY_TOKEN,
  Form8KEvent,
  Form8KEventRepositoryStorage,
} from "./Form8KEventSchema";

interface Form8KEventRepoOptions {
  eventRepository?: Form8KEventRepositoryStorage;
}

/**
 * Repository for 8-K event items. Rows carry `(extractor_id, extractor_version)`
 * so prior-version rows survive a re-extract until they're explicitly
 * superseded; query helpers accept optional version filters so callers can ask
 * for just one version's worth or all of them.
 */
export class Form8KEventRepo {
  readonly eventRepository: Form8KEventRepositoryStorage;

  constructor(options: Form8KEventRepoOptions = {}) {
    this.eventRepository =
      options.eventRepository ?? globalServiceRegistry.get(FORM_8K_EVENT_REPOSITORY_TOKEN);
  }

  async saveEvent(event: Omit<Form8KEvent, "event_id"> & { event_id?: number }): Promise<void> {
    await this.eventRepository.put(event as Form8KEvent);
  }

  async getEventsByAccession(
    cik: number,
    accessionNumber: string,
    extractorId?: string,
    extractorVersion?: string
  ): Promise<Form8KEvent[]> {
    const filter: Record<string, unknown> = { cik, accession_number: accessionNumber };
    if (extractorId !== undefined) filter.extractor_id = extractorId;
    if (extractorVersion !== undefined) filter.extractor_version = extractorVersion;
    return (await this.eventRepository.query(filter as any)) || [];
  }

  async getEventsByCik(
    cik: number,
    extractorId?: string,
    extractorVersion?: string
  ): Promise<Form8KEvent[]> {
    const filter: Record<string, unknown> = { cik };
    if (extractorId !== undefined) filter.extractor_id = extractorId;
    if (extractorVersion !== undefined) filter.extractor_version = extractorVersion;
    return (await this.eventRepository.query(filter as any)) || [];
  }

  async getEventsByItemCode(
    itemCode: string,
    extractorId?: string,
    extractorVersion?: string
  ): Promise<Form8KEvent[]> {
    const filter: Record<string, unknown> = { item_code: itemCode };
    if (extractorId !== undefined) filter.extractor_id = extractorId;
    if (extractorVersion !== undefined) filter.extractor_version = extractorVersion;
    return (await this.eventRepository.query(filter as any)) || [];
  }

  /**
   * Returns every row written by `(extractor_id, extractor_version)`. Lets
   * coverage / drop-previous ceremonies enumerate just the version they're
   * about to retire.
   */
  async getEventsByVersion(extractorId: string, extractorVersion: string): Promise<Form8KEvent[]> {
    return (
      (await this.eventRepository.query({
        extractor_id: extractorId,
        extractor_version: extractorVersion,
      } as any)) || []
    );
  }

  /**
   * Atomically replaces the set of events for one filing under one extractor
   * version. Existing rows matching `(cik, accession_number, extractor_id,
   * extractor_version)` are deleted; the new rows are inserted in their place.
   * Wrapped in a transaction so a mid-write failure rolls back both halves —
   * the table is never left with a partial mix of old and new items for the
   * same `(filing, version)`.
   *
   * Branches on `SEC_DB_TYPE` to use the native transaction primitive
   * (SQLite / Postgres). On the in-memory backend the operation runs
   * sequentially — the backend is synchronous and single-threaded so
   * mid-loop failures cannot interleave with another write.
   */
  async replaceEvents(
    cik: number,
    accession_number: string,
    extractor_id: string,
    extractor_version: string,
    events: ReadonlyArray<Omit<Form8KEvent, "event_id">>
  ): Promise<void> {
    const { replaceForm8KEvents } = await import("./Form8KEventReplace");
    await replaceForm8KEvents(this.eventRepository, {
      cik,
      accession_number,
      extractor_id,
      extractor_version,
      events,
    });
  }
}
