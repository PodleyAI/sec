/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  ACCREDITED_PORTAL_REPOSITORY_TOKEN,
  AccreditedPortal,
  AccreditedPortalRepositoryStorage,
  slugifyPortalId,
} from "./AccreditedPortalSchema";

interface AccreditedPortalRepoOptions {
  accreditedPortalRepository?: AccreditedPortalRepositoryStorage;
}

export class AccreditedPortalRepo implements AccreditedPortalRepoOptions {
  accreditedPortalRepository: AccreditedPortalRepositoryStorage;

  constructor(options: AccreditedPortalRepoOptions = {}) {
    this.accreditedPortalRepository =
      options.accreditedPortalRepository ??
      globalServiceRegistry.get(ACCREDITED_PORTAL_REPOSITORY_TOKEN);
  }

  async getPortal(portal_id: string): Promise<AccreditedPortal | undefined> {
    return this.accreditedPortalRepository.get({ portal_id });
  }

  /** Resolves a CLI-style reference: exact portal_id, else the slug of the given name. */
  async findPortal(ref: string): Promise<AccreditedPortal | undefined> {
    const byId = await this.getPortal(ref);
    if (byId) return byId;
    return this.getPortal(slugifyPortalId(ref));
  }

  async savePortal(portal: AccreditedPortal): Promise<AccreditedPortal> {
    await this.accreditedPortalRepository.put(portal);
    return portal;
  }

  /**
   * Upsert used by the seed import: seed fields (name/brand/url/live)
   * take the incoming values, while curated fields (cik/notes) survive from the
   * existing row — a re-import must never erase curation.
   */
  async upsertFromSeed(
    seed: Pick<AccreditedPortal, "portal_id" | "name" | "brand" | "url" | "live">
  ): Promise<AccreditedPortal> {
    const existing = await this.getPortal(seed.portal_id);
    return this.savePortal({
      ...seed,
      cik: existing?.cik ?? null,
      notes: existing?.notes ?? null,
    });
  }

  async getAllPortals(): Promise<AccreditedPortal[]> {
    return (await this.accreditedPortalRepository.getAll()) || [];
  }

  async getLivePortals(): Promise<AccreditedPortal[]> {
    return (await this.accreditedPortalRepository.query({ live: true })) || [];
  }
}
