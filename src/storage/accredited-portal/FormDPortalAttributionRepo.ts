/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  FORM_D_PORTAL_ATTRIBUTION_REPOSITORY_TOKEN,
  FormDPortalAttribution,
  FormDPortalAttributionRepositoryStorage,
} from "./FormDPortalAttributionSchema";

interface FormDPortalAttributionRepoOptions {
  attributionRepository?: FormDPortalAttributionRepositoryStorage;
}

export class FormDPortalAttributionRepo implements FormDPortalAttributionRepoOptions {
  attributionRepository: FormDPortalAttributionRepositoryStorage;

  constructor(options: FormDPortalAttributionRepoOptions = {}) {
    this.attributionRepository =
      options.attributionRepository ??
      globalServiceRegistry.get(FORM_D_PORTAL_ATTRIBUTION_REPOSITORY_TOKEN);
  }

  async saveAttribution(attribution: FormDPortalAttribution): Promise<FormDPortalAttribution> {
    await this.attributionRepository.put(attribution);
    return attribution;
  }

  async getAttribution(
    accession_number: string,
    portal_id: string
  ): Promise<FormDPortalAttribution | undefined> {
    return this.attributionRepository.get({ accession_number, portal_id });
  }

  async listByAccession(accession_number: string): Promise<FormDPortalAttribution[]> {
    return (await this.attributionRepository.query({ accession_number })) || [];
  }

  async listByPortal(portal_id: string): Promise<FormDPortalAttribution[]> {
    return (await this.attributionRepository.query({ portal_id })) || [];
  }

  async countAll(): Promise<number> {
    return this.attributionRepository.count();
  }

  async countAtVersion(attributor_version: string): Promise<number> {
    return this.attributionRepository.count({ attributor_version });
  }

  /** Purges rows written at a retired attributor version (drop-previous ceremony). */
  async deleteForAttributorVersion(attributor_version: string): Promise<number> {
    const count = await this.countAtVersion(attributor_version);
    if (count > 0) {
      await this.attributionRepository.deleteSearch({ attributor_version });
    }
    return count;
  }

  /** Clears one filing's attributions ahead of an unscoped recompute. */
  async clearAccession(accession_number: string): Promise<void> {
    await this.attributionRepository.deleteSearch({ accession_number });
  }

  /** Clears one portal's attributions ahead of a scoped recompute. */
  async clearPortal(portal_id: string): Promise<number> {
    const count = await this.attributionRepository.count({ portal_id });
    if (count > 0) {
      await this.attributionRepository.deleteSearch({ portal_id });
    }
    return count;
  }

  /** Clears the whole table ahead of an unscoped recompute. Returns rows cleared. */
  async clearAll(): Promise<number> {
    const count = await this.attributionRepository.count();
    if (count > 0) {
      await this.attributionRepository.deleteAll();
    }
    return count;
  }
}
