/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parsePhoneNumber } from "@sroussey/parse-phonenumber";
import type { Phone } from "./PhoneSchema";

export interface PhoneImport {
  phone_raw: string;
  country_code?: string;
}

/**
 * Cleans and normalizes a phone import object
 */
export function normalizePhone(importPhone: PhoneImport | null): Phone | undefined {
  if (!importPhone) return undefined;
  const phone_raw = importPhone.phone_raw.trim();
  if (!phone_raw) return undefined;
  if (phone_raw == "(000) 000-0000") return undefined;

  try {
    const countryCode = importPhone.country_code || "US";
    const phoneNumber = parsePhoneNumber(importPhone.phone_raw, {
      regionCode: countryCode,
    });

    if (!phoneNumber.possible) {
      return undefined;
    }

    const international_number = phoneNumber.number?.international;
    if (!international_number) {
      return undefined;
    }

    const phone: Phone = {
      country_code: regionCodeFor(phoneNumber, countryCode),
      international_number,
      type: phoneNumber.type || "unknown",
      raw_phone: importPhone.phone_raw,
    };

    return phone;
  } catch (error) {
    return undefined;
  }
}

/**
 * The country to record for a parsed number: the one the library DETECTED,
 * falling back to the region we asked it to assume.
 *
 * The two differ whenever the raw value carries its own country code, and the
 * detected one is the honest answer — a `+41` number read under a US region is
 * Swiss, whatever we guessed on the way in. The fallback covers a
 * `regionCode` that is not a country at all: libphonenumber returns `"001"`
 * for non-geographic ranges (toll-free `+800`, satellite), and the column is a
 * fixed-width ISO 3166-1 alpha-2, so storing that would fail the write.
 */
export function regionCodeFor(
  parsed: { regionCode?: string | undefined },
  requested: string
): string {
  const detected = parsed.regionCode;
  return detected !== undefined && detected.length === 2 ? detected : requested;
}

/**
 * Parses a number that carries its own country code, ignoring any region.
 *
 * The fallback for a value the region parse rejected. EDGAR's phone field is
 * free text and a foreign filer routinely writes the country code into it
 * bare — `41-0-91-941-8758`, `44 0 7770 637030` — which, read under a region,
 * is a national number with extra digits on the front and fails as too-long.
 * Prefixing `+` and dropping the region is what lets libphonenumber read those
 * leading digits as the country code they are.
 *
 * Requires `valid`, not merely `possible`, and that is the whole safety of it.
 * `possible` means only that the digit count is allowed somewhere in that
 * country's plan, so a mistyped US number lands on a foreign country whose
 * lengths happen to fit: `412-567-13254` reads as `possible` in Switzerland
 * while every one of its ten single-digit deletions is a VALID US number, with
 * nothing to choose between them. Recording one would put a real, dialable
 * number belonging to someone else in the database, indistinguishable from a
 * correctly parsed one. Dropping it is the honest outcome.
 */
export function normalizeInternationalPhone(phone_raw: string): Phone | undefined {
  const digits = phone_raw.replace(/\D/g, "");
  if (!digits) return undefined;
  try {
    const phoneNumber = parsePhoneNumber(`+${digits}`);
    if (!phoneNumber.valid) return undefined;
    const international_number = phoneNumber.number?.international;
    if (!international_number) return undefined;
    return {
      // No requested region to fall back to here — the number named its own
      // country, and a non-geographic range has none to record.
      country_code: regionCodeFor(phoneNumber, "US"),
      international_number,
      type: phoneNumber.type || "unknown",
      raw_phone: phone_raw,
    };
  } catch {
    return undefined;
  }
}
