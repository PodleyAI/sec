/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { COUNTRY_STATE_CODE_ARRAY, US_STATE_CODE_ARRAY } from "./AddressSchemaCodes";

const US_STATE_CODE_SET = new Set<string>(US_STATE_CODE_ARRAY.map(([code]) => code));

// SEC's stateOrCountry field uses SEC-specific 2-char codes for non-US
// countries (e.g. "B3" = Albania). PhoneSchema.country_code is documented as
// ISO 3166-1 alpha-2 and gets passed to phone parsing as a regionCode, so we
// have to translate. Map SEC code → ISO; also accept already-ISO inputs.
const SEC_CODE_TO_ISO = new Map<string, string>(
  COUNTRY_STATE_CODE_ARRAY.map(([iso, secCode]) => [secCode as string, iso as string])
);
const ISO_CODE_SET = new Set<string>(COUNTRY_STATE_CODE_ARRAY.map(([iso]) => iso as string));

/**
 * Resolve EDGAR's `stateOrCountry` field to an ISO 3166-1 alpha-2 country
 * code. US state codes resolve to "US"; SEC country codes are mapped to ISO;
 * inputs that are already ISO pass through. Returns undefined when nothing
 * matches so PhoneRepo can fall back to its own defaults rather than
 * receiving a bogus regionCode.
 *
 * Shared rather than per-form: every exempt-offering form carries the same
 * `stateOrCountry` shape beside a phone, and a second copy of this mapping is
 * a second place for the SEC-to-ISO table to go stale. It lives under
 * `storage/address` because that is where the code tables it reads live.
 */
export function resolveCountryCode(stateOrCountry: string | undefined | null): string | undefined {
  if (!stateOrCountry) return undefined;
  const code = stateOrCountry.trim().toUpperCase();
  if (!code) return undefined;
  if (US_STATE_CODE_SET.has(code)) return "US";
  const iso = SEC_CODE_TO_ISO.get(code);
  if (iso) return iso;
  if (ISO_CODE_SET.has(code)) return code;
  return undefined;
}
