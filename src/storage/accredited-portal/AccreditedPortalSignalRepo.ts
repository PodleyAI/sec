/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  ACCREDITED_PORTAL_SIGNAL_REPOSITORY_TOKEN,
  AccreditedPortalSignal,
  AccreditedPortalSignalRepositoryStorage,
  AccreditedPortalSignalType,
} from "./AccreditedPortalSignalSchema";

interface AccreditedPortalSignalRepoOptions {
  signalRepository?: AccreditedPortalSignalRepositoryStorage;
}

export class AccreditedPortalSignalRepo implements AccreditedPortalSignalRepoOptions {
  signalRepository: AccreditedPortalSignalRepositoryStorage;

  constructor(options: AccreditedPortalSignalRepoOptions = {}) {
    this.signalRepository =
      options.signalRepository ??
      globalServiceRegistry.get(ACCREDITED_PORTAL_SIGNAL_REPOSITORY_TOKEN);
  }

  async getSignal(
    signal_type: AccreditedPortalSignalType,
    signal_value: string
  ): Promise<AccreditedPortalSignal | undefined> {
    return this.signalRepository.get({ signal_type, signal_value });
  }

  /** Batched lookup of many (type, value) keys; returns only found rows. */
  async getSignalsBulk(
    keys: readonly { signal_type: AccreditedPortalSignalType; signal_value: string }[]
  ): Promise<AccreditedPortalSignal[]> {
    if (keys.length === 0) return [];
    return this.signalRepository.getBulk(keys);
  }

  async saveSignal(signal: AccreditedPortalSignal): Promise<AccreditedPortalSignal> {
    await this.signalRepository.put(signal);
    return signal;
  }

  /**
   * Seed-import write: creates or refreshes a seed-sourced signal but never
   * touches a manual one — curators outrank the seed file, including when they
   * re-pointed the same (type, value) at a different portal.
   */
  async upsertSeedSignal(
    signal: Omit<AccreditedPortalSignal, "source" | "created_at">
  ): Promise<boolean> {
    const existing = await this.getSignal(signal.signal_type, signal.signal_value);
    if (existing?.source === "manual") return false;
    await this.saveSignal({
      ...signal,
      source: "seed",
      created_at: existing?.created_at ?? new Date().toISOString(),
    });
    return true;
  }

  async removeSignal(signal_type: AccreditedPortalSignalType, signal_value: string): Promise<void> {
    await this.signalRepository.delete({ signal_type, signal_value });
  }

  async listByPortal(portal_id: string): Promise<AccreditedPortalSignal[]> {
    return (await this.signalRepository.query({ portal_id })) || [];
  }

  async getAllSignals(): Promise<AccreditedPortalSignal[]> {
    return (await this.signalRepository.getAll()) || [];
  }
}
