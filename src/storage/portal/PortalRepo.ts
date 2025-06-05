//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { globalServiceRegistry } from "@podley/util";
import { Portal, PORTAL_REPOSITORY_TOKEN, PortalRepositoryStorage } from "./PortalSchema";

// Options for the PortalRepo
interface PortalRepoOptions {
  portalRepository?: PortalRepositoryStorage;
}

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

  async deletePortal(cik: number): Promise<void> {
    await this.portalRepository.delete({ cik });
  }

  async getAllPortals(): Promise<Portal[]> {
    return (await this.portalRepository.getAll()) || [];
  }

  async getActivePortals(): Promise<Portal[]> {
    return (await this.portalRepository.search({ live: true })) || [];
  }

  async getPortalsByBrand(brand: string): Promise<Portal[]> {
    return (await this.portalRepository.search({ brand })) || [];
  }

  async searchPortalsByName(name: string): Promise<Portal[]> {
    return (await this.portalRepository.search({ name })) || [];
  }
}
