/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export const RELATION_TYPE_REGA_ISSUER = "form-rega:issuer";
export const RELATION_TYPE_REGA_SERVICE_PROVIDER = "form-rega:service-provider";
export const RELATION_TYPE_REGA_SIGNATURE = "form-rega:signature";
export const RELATION_TYPE_REGA_CONNECTION = "form-rega:connection";

export interface ServiceProviderEntry {
  readonly type: string;
  readonly name: string | null;
  readonly fees: number | null;
  readonly crd: string | null;
}

/**
 * Normalizes service provider field name differences across 1-A, 1-K, and 1-Z forms
 * into a uniform array of service provider entries.
 *
 * - Form 1-A uses e.g. `underwritersServiceProviderName` (string)
 * - Form 1-K uses e.g. `underwrittenSpName` (string)
 * - Form 1-Z uses e.g. `underwrittenSpName` (string[])
 */
export function extractServiceProviders(
  summaryInfo: Record<string, unknown>,
  formType: "1-A" | "1-K" | "1-Z"
): ServiceProviderEntry[] {
  const results: ServiceProviderEntry[] = [];

  interface ProviderMapping {
    readonly type: string;
    readonly nameKeys: readonly string[];
    readonly feesKeys: readonly string[];
    readonly crdKeys: readonly string[];
  }

  const mappings: readonly ProviderMapping[] = [
    {
      type: "underwriter",
      nameKeys: ["underwritersServiceProviderName", "underwrittenSpName"],
      feesKeys: ["underwritersFees", "underwriterFees"],
      crdKeys: ["brokerDealerCrdNumber", "crdNumberBrokerDealer"],
    },
    {
      type: "sales_commission",
      nameKeys: ["salesCommissionsServiceProviderName", "salesCommissionsSpName"],
      feesKeys: ["salesCommissionsServiceProviderFees", "salesCommissionsFee"],
      crdKeys: [],
    },
    {
      type: "finder",
      nameKeys: ["findersFeesServiceProviderName", "findersSpName"],
      feesKeys: ["finderFeesFee", "findersFees"],
      crdKeys: [],
    },
    {
      type: "auditor",
      nameKeys: ["auditorServiceProviderName", "auditorSpName"],
      feesKeys: ["auditorFees"],
      crdKeys: [],
    },
    {
      type: "legal",
      nameKeys: ["legalServiceProviderName", "legalSpName"],
      feesKeys: ["legalFees"],
      crdKeys: [],
    },
    {
      type: "promoter",
      nameKeys: ["promotersServiceProviderName", "promoterSpName"],
      feesKeys: ["promotersFees"],
      crdKeys: [],
    },
    {
      type: "blue_sky",
      nameKeys: ["blueSkyServiceProviderName", "blueSkySpName"],
      feesKeys: ["blueSkyFees"],
      crdKeys: [],
    },
  ];

  for (const mapping of mappings) {
    const rawName = findValue(summaryInfo, mapping.nameKeys);
    const rawFees = findValue(summaryInfo, mapping.feesKeys);
    const rawCrd = findValue(summaryInfo, mapping.crdKeys);

    if (rawName === undefined && rawFees === undefined) continue;

    const fees = typeof rawFees === "number" ? rawFees : null;
    const crd = typeof rawCrd === "string" ? rawCrd : null;

    // 1-Z service provider names can be arrays
    if (Array.isArray(rawName)) {
      for (const name of rawName) {
        results.push({ type: mapping.type, name: name ?? null, fees, crd });
      }
    } else {
      const name = typeof rawName === "string" ? rawName : null;
      results.push({ type: mapping.type, name, fees, crd });
    }
  }

  return results;
}

function findValue(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined) {
      return obj[key];
    }
  }
  return undefined;
}
