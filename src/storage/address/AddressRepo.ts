//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { globalServiceRegistry } from "@podley/util";
import { AddressImport, normalizeAddress } from "./AddressNormalization";
import {
  Address,
  ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  ADDRESS_REPOSITORY_TOKEN,
  AddressJunctionRepositoryStorage,
  AddressRepositoryStorage,
} from "./AddressSchema";

// Options for the AddressRepo
interface AddressRepoOptions {
  addressRepository?: AddressRepositoryStorage;
  addressJunctionRepository?: AddressJunctionRepositoryStorage;
}

/**
 * Address repository
 */
export class AddressRepo implements AddressRepoOptions {
  addressRepository: AddressRepositoryStorage;
  addressJunctionRepository: AddressJunctionRepositoryStorage;

  constructor(options: AddressRepoOptions = {}) {
    this.addressRepository =
      options.addressRepository ?? globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN);

    this.addressJunctionRepository =
      options.addressJunctionRepository ??
      globalServiceRegistry.get(ADDRESS_JUNCTION_REPOSITORY_TOKEN);
  }

  async getAddress(address_hash_id: string): Promise<Address | undefined> {
    return this.addressRepository.get({ address_hash_id });
  }

  async saveAddress(address: AddressImport) {
    const normalizedAddress = normalizeAddress(address);
    if (!normalizedAddress) {
      throw new Error(
        `Unable to clean and normalize the provided address ${JSON.stringify(address)}`
      );
    }
    await this.addressRepository.put(normalizedAddress);
    return normalizedAddress;
  }

  async saveRelatedEntity(address_hash_id: string, relation_name: string, cik: number) {
    this.addressJunctionRepository.put({
      address_hash_id,
      relation_name,
      cik,
    });
  }
}
