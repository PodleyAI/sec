/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AddressImport } from "../address/AddressNormalization";
import { normalizeAddress } from "../address/AddressNormalization";
import { normalizeCompanyName } from "../company/CompanyNormalization";
import { normalizePhone } from "../phone/PhoneNormalization";
import { isBadPersonField } from "../../types/edgar/bad-data";

/**
 * Signal values must equal what the Form D ingest path produces, so each
 * normalizer delegates to the exact helper that path uses:
 * names → {@link normalizeCompanyName} (lower-cased for case-blind equality),
 * phones → {@link normalizePhone}'s international_number,
 * addresses → {@link normalizeAddress}'s address_hash_id.
 */

/** Minimum useful length for a name signal; shorter values only collide. */
const MIN_NAME_SIGNAL_LENGTH = 3;

export function normalizeNameSignal(name: string | null | undefined): string | null {
  // Placeholder tokens ("None", "N/A", "same", ...) are never real entity
  // names. Rejecting them here keeps every producer — issuer/related-person/
  // sales-compensation ingest, CLI curation, and the observation backfill —
  // consistent by construction instead of each filtering separately.
  if (!name || isBadPersonField(name)) return null;
  const normalized = normalizeCompanyName(name);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase().trim();
  if (lowered.length < MIN_NAME_SIGNAL_LENGTH || isBadPersonField(lowered)) return null;
  return lowered;
}

export function normalizePhoneSignal(
  raw: string | null | undefined,
  country_code?: string
): string | null {
  if (!raw) return null;
  const phone = normalizePhone({ phone_raw: raw, country_code });
  return phone?.international_number ?? null;
}

export function normalizeAddressSignal(address: AddressImport | null | undefined): string | null {
  if (!address) return null;
  const normalized = normalizeAddress(address);
  return normalized?.address_hash_id ?? null;
}
