/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "@workglow/util";
import {
  FORM_8K_EVENT_REPOSITORY_TOKEN,
  Form8KEvent,
  Form8KEventRepositoryStorage,
} from "./Form8KEventSchema";

interface Form8KEventRepoOptions {
  eventRepository?: Form8KEventRepositoryStorage;
}

/**
 * Repository for 8-K event items
 */
export class Form8KEventRepo {
  readonly eventRepository: Form8KEventRepositoryStorage;

  constructor(options: Form8KEventRepoOptions = {}) {
    this.eventRepository =
      options.eventRepository ?? globalServiceRegistry.get(FORM_8K_EVENT_REPOSITORY_TOKEN);
  }

  async saveEvent(event: Form8KEvent): Promise<void> {
    await this.eventRepository.put(event);
  }

  async getEventsByAccession(
    cik: number,
    accessionNumber: string
  ): Promise<Form8KEvent[]> {
    return (await this.eventRepository.query({ cik, accession_number: accessionNumber })) || [];
  }

  async getEventsByCik(cik: number): Promise<Form8KEvent[]> {
    return (await this.eventRepository.query({ cik })) || [];
  }

  async getEventsByItemCode(itemCode: string): Promise<Form8KEvent[]> {
    return (await this.eventRepository.query({ item_code: itemCode })) || [];
  }
}
