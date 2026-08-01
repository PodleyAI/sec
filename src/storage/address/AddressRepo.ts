/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
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

  /**
   * Like {@link saveAddress}, but returns undefined instead of throwing when the
   * address cannot be normalized into a usable one (no street, or no city).
   *
   * For callers where the address is one detail among many — a company's contact
   * block, say — an unusable address must not take down the whole record. EDGAR
   * routinely carries an address object with every field blank, so throwing
   * there would discard the entire filer. Normalization runs once, so this is
   * not `saveAddress` wrapped in a try/catch (which would also swallow genuine
   * storage errors).
   */
  async saveAddressIfUsable(address: AddressImport) {
    const normalizedAddress = normalizeAddress(address);
    if (!normalizedAddress) return undefined;
    await this.addressRepository.put(normalizedAddress);
    return normalizedAddress;
  }

  async saveRelatedEntity(address_hash_id: string, relation_name: string, cik: number) {
    await this.addressJunctionRepository.put({
      address_hash_id,
      relation_name,
      cik,
    });
  }
}
