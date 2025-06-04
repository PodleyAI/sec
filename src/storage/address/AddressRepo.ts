//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken, globalServiceRegistry } from "@podley/util";
import { Static } from "@sinclair/typebox";
import { AddressImport, normalizeAddress } from "./AddressNormalization";
import { AddressesEntityJunctionSchema, AddressSchema } from "./AddressSchema";

/**
 * Address schema
 */
export type Address = Static<typeof AddressSchema>;
export const AddressPrimaryKeyNames = ["address_hash_id"] as const;
export type AddressRepositoryStorage = TabularRepository<
  typeof AddressSchema,
  typeof AddressPrimaryKeyNames
>;

/**
 * Address junction schema
 */
export const AddressJunctionPrimaryKeyNames = ["address_hash_id", "relation_name", "cik"] as const;
export type AddressJunctionRepositoryStorage = TabularRepository<
  typeof AddressesEntityJunctionSchema,
  typeof AddressJunctionPrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const ADDRESS_REPOSITORY_TOKEN = createServiceToken<AddressRepositoryStorage>(
  "sec.storage.addressRepository"
);
export const ADDRESS_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<AddressJunctionRepositoryStorage>("sec.storage.addressJunctionRepository");

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

  async saveAddress(address: AddressImport, relation_name: string, cik: number) {
    const normalizedAddress = normalizeAddress(address);
    if (!normalizedAddress) {
      throw new Error("Unable to clean and normalize the provided address");
    }
    await this.addressRepository.put(normalizedAddress);
    if (relation_name && cik) {
      this.addressJunctionRepository.put({
        address_hash_id: normalizedAddress.address_hash_id,
        relation_name,
        cik,
      });
    }
    return normalizedAddress;
  }
}
