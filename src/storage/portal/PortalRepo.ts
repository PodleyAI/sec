/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { KeyedMutex } from "../../util/KeyedMutex";
import { isStaleByAsOf } from "../../util/asOfGuard";
import { Portal, PORTAL_REPOSITORY_TOKEN, PortalRepositoryStorage } from "./PortalSchema";

// Options for the PortalRepo
interface PortalRepoOptions {
  portalRepository?: PortalRepositoryStorage;
}

/**
 * Serialises the read-guard-write of the mutable current portal row per CIK.
 * Module-scoped because every caller builds a fresh {@link PortalRepo}.
 */
const portalWriteLock = new KeyedMutex<number>();

/**
 * Portal repository
 */
export class PortalRepo implements PortalRepoOptions {
  portalRepository: PortalRepositoryStorage;

  constructor(options: PortalRepoOptions = {}) {
    this.portalRepository =
      options.portalRepository ?? globalServiceRegistry.get(PORTAL_REPOSITORY_TOKEN);
  }

  async getPortal(cik: number): Promise<Portal | undefined> {
    return await this.portalRepository.get({ cik });
  }

  async savePortal(portal: Portal): Promise<Portal> {
    await this.portalRepository.put(portal);
    return portal;
  }

  /**
   * Persist the mutable current portal row under an `as_of` staleness guard,
   * atomically. Reads the existing row, skips the write when the incoming
   * `filing_date` is older than the stored `as_of` (an out-of-order replay — see
   * {@link isStaleByAsOf}), and otherwise writes the row `build` returns. `build`
   * receives the row read inside the lock so a CFPORTAL/A can inherit identifying
   * fields the registered portal still carries.
   *
   * The whole read-merge-write runs inside a per-CIK lock so two portal filings
   * processed concurrently cannot both read the same prior row and lost-update it
   * (e.g. resurrect a withdrawn portal).
   */
  async savePortalAsOf(
    cik: number,
    filing_date: string,
    build: (existing: Portal | undefined) => Portal
  ): Promise<void> {
    await portalWriteLock.lock(cik, async () => {
      const existing = await this.getPortal(cik);
      if (isStaleByAsOf(existing?.as_of, filing_date)) return;
      await this.savePortal(build(existing));
    });
  }

  async deletePortal(cik: number): Promise<void> {
    await this.portalRepository.delete({ cik });
  }

  async getAllPortals(): Promise<Portal[]> {
    return (await this.portalRepository.getAll()) || [];
  }

  async getActivePortals(): Promise<Portal[]> {
    return (await this.portalRepository.query({ live: true })) || [];
  }

  async getPortalsByBrand(brand: string): Promise<Portal[]> {
    return (await this.portalRepository.query({ brand })) || [];
  }

  async searchPortalsByName(name: string): Promise<Portal[]> {
    return (await this.portalRepository.query({ name })) || [];
  }
}
