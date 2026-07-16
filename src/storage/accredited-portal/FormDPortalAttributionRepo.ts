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

  /** Clears one portal's attributions ahead of a scoped recompute. */
  async clearPortal(portal_id: string): Promise<number> {
    const rows = await this.listByPortal(portal_id);
    for (const row of rows) {
      await this.attributionRepository.delete({
        accession_number: row.accession_number,
        portal_id: row.portal_id,
      });
    }
    return rows.length;
  }

  /** Clears the whole table ahead of an unscoped recompute. */
  async clearAll(): Promise<void> {
    await this.attributionRepository.deleteAll();
  }
}
