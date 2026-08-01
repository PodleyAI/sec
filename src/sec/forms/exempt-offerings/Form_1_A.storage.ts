/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import {
  COUNTRY_STATE_CODE_ARRAY,
  US_STATE_CODE_ARRAY,
} from "../../../storage/address/AddressSchemaCodes";
import { hasCompanyEnding } from "../../../storage/company/CompanyNormalization";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";

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
 */
function resolveCountryCode(stateOrCountry: string | undefined | null): string | undefined {
  if (!stateOrCountry) return undefined;
  const code = stateOrCountry.trim().toUpperCase();
  if (!code) return undefined;
  if (US_STATE_CODE_SET.has(code)) return "US";
  const iso = SEC_CODE_TO_ISO.get(code);
  if (iso) return iso;
  if (ISO_CODE_SET.has(code)) return code;
  return undefined;
}

import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import type { RegAOffering } from "../../../storage/reg-a/RegAOfferingSchema";
import type { RegAOfferingHistory } from "../../../storage/reg-a/RegAOfferingHistorySchema";
import type { RegAFinancialData } from "../../../storage/reg-a/RegAFinancialDataSchema";
import type { RegAEquityClass } from "../../../storage/reg-a/RegAEquityClassSchema";
import {
  extractServiceProviders,
  RELATION_TYPE_REGA_SERVICE_PROVIDER,
} from "./RegA_shared";
import type { Form1A } from "./Form_1_A.schema";
import { numScalar } from "../_valueHelpers";
import { EntityObserver } from "../../../resolver/EntityObserver";
import { PersonResolver } from "../../../resolver/PersonResolver";
import { CompanyResolver } from "../../../resolver/CompanyResolver";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { PersonObservationTitleRepo } from "../../../storage/observation/PersonObservationTitleRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonIdentityLinkRepo } from "../../../storage/canonical/PersonIdentityLinkRepo";
import { CompanyIdentityLinkRepo } from "../../../storage/canonical/CompanyIdentityLinkRepo";
import { CanonicalPersonRepo } from "../../../storage/canonical/CanonicalPersonRepo";
import { CanonicalCompanyRepo } from "../../../storage/canonical/CanonicalCompanyRepo";
import { CanonicalPersonAliasRepo } from "../../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalCompanyAliasRepo } from "../../../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalPersonAddressRepo } from "../../../storage/canonical/CanonicalPersonAddressRepo";
import { CanonicalPersonPhoneRepo } from "../../../storage/canonical/CanonicalPersonPhoneRepo";
import { CanonicalCompanyAddressRepo } from "../../../storage/canonical/CanonicalCompanyAddressRepo";
import { CanonicalCompanyPhoneRepo } from "../../../storage/canonical/CanonicalCompanyPhoneRepo";
import { PersonRoleRepo } from "../../../storage/canonical/PersonRoleRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";

interface Form1AStorageContext {
  readonly accession_number: string;
  readonly extractor_id: "1-A";
  readonly extractor_version: string;
  readonly observer: EntityObserver;
}

async function processIssuer(cik: number, form1A: Form1A, ctx: Form1AStorageContext): Promise<void> {
  const addressRepo = new AddressRepo();
  const phoneRepo = new PhoneRepo();

  const employeesInfo = form1A.formData.employeesInfo[0];
  const issuerInfo = form1A.formData.issuerInfo;

  let addr: Awaited<ReturnType<typeof addressRepo.saveAddress>> | null = null;
  try {
    addr = await addressRepo.saveAddress({
      street1: issuerInfo.street1,
      street2: issuerInfo.street2,
      city: issuerInfo.city,
      stateOrCountry: issuerInfo.stateOrCountry,
      zipCode: issuerInfo.zipCode,
    });
  } catch (error) {
    console.warn(
      `Failed to save address for Form 1-A issuer ${employeesInfo.issuerName}:`,
      error
    );
  }

  let phone: Awaited<ReturnType<typeof phoneRepo.savePhone>> | null = null;
  try {
    phone = await phoneRepo.savePhone({
      phone_raw: issuerInfo.phoneNumber,
      country_code: resolveCountryCode(issuerInfo.stateOrCountry),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Failed to save phone "${issuerInfo.phoneNumber}" for issuer ${employeesInfo.issuerName}: ${message}`
    );
  }

  await ctx.observer.observeCompany({
    accession_number: ctx.accession_number,
    extractor_id: ctx.extractor_id,
    extractor_version: ctx.extractor_version,
    observation_index: 0,
    cik,
    name: employeesInfo.issuerName,
    address_id: addr?.address_hash_id ?? null,
    international_number: phone?.international_number ?? null,
    source_context: JSON.stringify({ relation: "form-1-a:issuer" }),
  });
}

async function processConnection(cik: number, form1A: Form1A, ctx: Form1AStorageContext): Promise<void> {
  const issuerInfo = form1A.formData.issuerInfo;
  if (!issuerInfo.connectionName) return;

  const addressRepo = new AddressRepo();
  const phoneRepo = new PhoneRepo();

  const connectionName = issuerInfo.connectionName;

  let addr: Awaited<ReturnType<typeof addressRepo.saveAddress>> | null = null;
  if (issuerInfo.connectionStreet1) {
    try {
      addr = await addressRepo.saveAddress({
        street1: issuerInfo.connectionStreet1,
        street2: issuerInfo.connectionStreet2,
        city: issuerInfo.connectionCity,
        stateOrCountry: issuerInfo.connectionStateOrCountry,
        zipCode: issuerInfo.connectionZipCode,
      });
    } catch (error) {
      console.warn(`Failed to save connection address for ${connectionName}:`, error);
    }
  }

  let phone: Awaited<ReturnType<typeof phoneRepo.savePhone>> | null = null;
  if (issuerInfo.connectionPhoneNumber) {
    try {
      phone = await phoneRepo.savePhone({
        phone_raw: issuerInfo.connectionPhoneNumber,
        country_code: "US",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Failed to save phone "${issuerInfo.connectionPhoneNumber}" for connection ${connectionName}: ${message}`
      );
    }
  }

  if (hasCompanyEnding(connectionName)) {
    await ctx.observer.observeCompany({
      accession_number: ctx.accession_number,
      extractor_id: ctx.extractor_id,
      extractor_version: ctx.extractor_version,
      observation_index: 100,
      cik: null,
      name: connectionName,
      address_id: addr?.address_hash_id ?? null,
      international_number: phone?.international_number ?? null,
      source_context: JSON.stringify({ relation: "form-1-a:connection" }),
    });
  } else {
    await ctx.observer.observePerson({
      accession_number: ctx.accession_number,
      extractor_id: ctx.extractor_id,
      extractor_version: ctx.extractor_version,
      observation_index: 100,
      source_filing_issuer_cik: cik,
      last_name: connectionName,
      titles: ["Connection"],
      relationship: "form-1-a:connection",
      address_id: addr?.address_hash_id ?? null,
      source_context: JSON.stringify({ relation: "form-1-a:connection" }),
    });
  }
}

async function processServiceProviders(
  cik: number,
  file_number: string,
  accession_number: string,
  form1A: Form1A,
  ctx: Form1AStorageContext
): Promise<void> {
  const regARepo = new RegAOfferingRepo();

  const summaryInfo = form1A.formData.summaryInfo;
  const providers = extractServiceProviders(summaryInfo as Record<string, unknown>, "1-A");

  let providerIndex = 200;
  for (const provider of providers) {
    await regARepo.saveServiceProvider({
      cik,
      file_number,
      accession_number,
      provider_type: provider.type,
      provider_name: provider.name,
      fees: provider.fees,
      crd: provider.crd,
    });

    if (provider.name) {
      await ctx.observer.observeCompany({
        accession_number: ctx.accession_number,
        extractor_id: ctx.extractor_id,
        extractor_version: ctx.extractor_version,
        observation_index: providerIndex,
        cik: null,
        name: provider.name,
        address_id: null,
        source_context: JSON.stringify({
          relation: RELATION_TYPE_REGA_SERVICE_PROVIDER,
          provider_type: provider.type,
        }),
      });
      providerIndex++;
    }
  }
}

async function processFinancialData(
  cik: number,
  file_number: string,
  accession_number: string,
  form1A: Form1A
): Promise<void> {
  const regARepo = new RegAOfferingRepo();
  const issuerInfo = form1A.formData.issuerInfo;

  // Each numeric leaf is passed through numScalar so an empty / whitespace
  // value persists as null (and is therefore skipped below) rather than
  // being coerced to a fabricated 0 by Value.Convert against Type.Number().
  const fields: Array<[string, number | null]> = [
    ["cashEquivalents", numScalar(issuerInfo.cashEquivalents)],
    ["investmentSecurities", numScalar(issuerInfo.investmentSecurities)],
    ["totalInvestments", numScalar(issuerInfo.totalInvestments)],
    ["accountsReceivable", numScalar(issuerInfo.accountsReceivable)],
    ["loans", numScalar(issuerInfo.loans)],
    ["propertyPlantEquipment", numScalar(issuerInfo.propertyPlantEquipment)],
    ["propertyAndEquipment", numScalar(issuerInfo.propertyAndEquipment)],
    ["totalAssets", numScalar(issuerInfo.totalAssets)],
    ["accountsPayable", numScalar(issuerInfo.accountsPayable)],
    ["policyLiabilitiesAndAccruals", numScalar(issuerInfo.policyLiabilitiesAndAccruals)],
    ["deposits", numScalar(issuerInfo.deposits)],
    ["longTermDebt", numScalar(issuerInfo.longTermDebt)],
    ["totalLiabilities", numScalar(issuerInfo.totalLiabilities)],
    ["totalStockholderEquity", numScalar(issuerInfo.totalStockholderEquity)],
    ["totalLiabilitiesAndEquity", numScalar(issuerInfo.totalLiabilitiesAndEquity)],
    ["totalRevenues", numScalar(issuerInfo.totalRevenues)],
    ["totalInterestIncome", numScalar(issuerInfo.totalInterestIncome)],
    ["costAndExpensesApplToRevenues", numScalar(issuerInfo.costAndExpensesApplToRevenues)],
    ["totalInterestExpenses", numScalar(issuerInfo.totalInterestExpenses)],
    ["depreciationAndAmortization", numScalar(issuerInfo.depreciationAndAmortization)],
    ["netIncome", numScalar(issuerInfo.netIncome)],
    ["earningsPerShareBasic", numScalar(issuerInfo.earningsPerShareBasic)],
    ["earningsPerShareDiluted", numScalar(issuerInfo.earningsPerShareDiluted)],
  ];

  for (const [fieldName, fieldValue] of fields) {
    if (fieldValue === null) continue;
    const data: RegAFinancialData = {
      cik,
      file_number,
      accession_number,
      field_name: fieldName,
      field_value: fieldValue,
    };
    await regARepo.saveFinancialData(data);
  }
}

async function processEquityClasses(
  cik: number,
  file_number: string,
  accession_number: string,
  form1A: Form1A
): Promise<void> {
  const regARepo = new RegAOfferingRepo();

  for (const eq of form1A.formData.commonEquity) {
    const entry: RegAEquityClass = {
      cik,
      file_number,
      accession_number,
      equity_type: "common",
      class_name: eq.commonEquityClassName ?? null,
      outstanding: eq.outstandingCommonEquity,
      cusip: eq.commonCusipEquity ?? null,
      publicly_traded: eq.publiclyTradedCommonEquity ?? null,
    };
    await regARepo.saveEquityClass(entry);
  }

  for (const eq of form1A.formData.preferredEquity) {
    const entry: RegAEquityClass = {
      cik,
      file_number,
      accession_number,
      equity_type: "preferred",
      class_name: eq.preferredEquityClassName ?? null,
      outstanding: eq.outstandingPreferredEquity,
      cusip: eq.preferredCusipEquity ?? null,
      publicly_traded: eq.publiclyTradedPreferredEquity ?? null,
    };
    await regARepo.saveEquityClass(entry);
  }

  for (const eq of form1A.formData.debtSecurities) {
    const entry: RegAEquityClass = {
      cik,
      file_number,
      accession_number,
      equity_type: "debt",
      class_name: eq.debtSecuritiesClassName ?? null,
      outstanding: eq.outstandingDebtSecurities,
      cusip: eq.cusipDebtSecurities ?? null,
      publicly_traded: eq.publiclyTradedDebtSecurities ?? null,
    };
    await regARepo.saveEquityClass(entry);
  }
}

export async function processForm1A({
  cik,
  file_number,
  accession_number,
  filing_date,
  primary_doc,
  form1A,
}: {
  cik: number;
  file_number: string;
  accession_number: string;
  filing_date: string;
  primary_doc: string;
  form1A: Form1A;
}): Promise<void> {
  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );

  const [personSlot, companySlot] = await Promise.all([
    getActiveSlot(versionRegistry, "resolver", "person"),
    getActiveSlot(versionRegistry, "resolver", "company"),
  ]);

  const activeResolverPersonVersion = personSlot?.semver ?? "1.0.0";
  const activeResolverCompanyVersion = companySlot?.semver ?? "1.0.0";

  // 1.1.0: numScalar() treats whitespace-only/empty numeric elements as null
  // instead of fabricating 0 via Value.Convert. Bumped to force re-extract.
  const extractor_version = "1.1.0";

  const personObservationRepo = new PersonObservationRepo();
  const companyObservationRepo = new CompanyObservationRepo();
  const personIdentityLinkRepo = new PersonIdentityLinkRepo();
  const companyIdentityLinkRepo = new CompanyIdentityLinkRepo();
  const canonicalPersonRepo = new CanonicalPersonRepo();
  const canonicalCompanyRepo = new CanonicalCompanyRepo();
  const canonicalPersonAliasRepo = new CanonicalPersonAliasRepo();
  const canonicalCompanyAliasRepo = new CanonicalCompanyAliasRepo();
  const canonicalPersonAddressRepo = new CanonicalPersonAddressRepo();
  const canonicalPersonPhoneRepo = new CanonicalPersonPhoneRepo();
  const canonicalCompanyAddressRepo = new CanonicalCompanyAddressRepo();
  const canonicalCompanyPhoneRepo = new CanonicalCompanyPhoneRepo();

  const personResolver = new PersonResolver({
    canonicalPersonRepo,
    canonicalPersonAliasRepo,
    activeResolverVersion: activeResolverPersonVersion,
  });

  const companyResolver = new CompanyResolver({
    canonicalCompanyRepo,
    canonicalCompanyAliasRepo,
    activeResolverVersion: activeResolverCompanyVersion,
  });

  const observer = new EntityObserver({
    personObservationRepo,
    personObservationTitleRepo: new PersonObservationTitleRepo(),
    companyObservationRepo,
    personIdentityLinkRepo,
    companyIdentityLinkRepo,
    personResolver,
    companyResolver,
    canonicalPersonAddressRepo,
    canonicalPersonPhoneRepo,
    canonicalCompanyAddressRepo,
    canonicalCompanyPhoneRepo,
    personRoleRepo: new PersonRoleRepo(),
    activeResolverPersonVersion,
    activeResolverCompanyVersion,
  });

  const ctx: Form1AStorageContext = {
    accession_number,
    extractor_id: "1-A",
    extractor_version,
    observer,
  };

  const regARepo = new RegAOfferingRepo();
  const summaryInfo = form1A.formData.summaryInfo;
  const employeesInfo = form1A.formData.employeesInfo[0];

  // 1-A/A and 1-A POS restate the offering data but say nothing about the
  // lifecycle: a post-qualification amendment processed after a 1-K / 1-Z must
  // not regress a "reporting"/"exit" offering back to "pending" — so the status
  // is carried forward from the existing row. The mutable row is latest-by-
  // filing-date; the read-merge-write is atomic per (cik, file_number) and skips
  // stale out-of-order writes (an undated "" filing is treated as stale). The
  // history row below is per-accession and always recorded.
  await regARepo.saveOfferingAsOf(cik, file_number, filing_date, (existing) => ({
    cik,
    file_number,
    issuer_name: employeesInfo.issuerName,
    jurisdiction: employeesInfo.jurisdictionOrganization,
    sic_code: employeesInfo.sicCode,
    tier: summaryInfo.indicateTier1Tier2Offering,
    financial_statement_audit_status: summaryInfo.financialStatementAuditStatus,
    securities_offered_type: summaryInfo.securitiesOfferedTypes,
    industry_group: form1A.formData.issuerInfo.industryGroup,
    status: existing?.status ?? "pending",
    as_of: filing_date || existing?.as_of || null,
  }));

  const history: RegAOfferingHistory = {
    cik,
    file_number,
    accession_number,
    filing_date,
    qualification_date: null,
    commence_date: null,
    securities_qualified_sold: null,
    securities_sold: null,
    price_per_security: numScalar(summaryInfo.pricePerSecurity),
    aggregate_offering_price: null,
    aggregate_offering_price_holders: null,
    issuer_aggregate_offering: numScalar(summaryInfo.issuerAggregateOffering),
    security_holder_aggregate: numScalar(summaryInfo.securityHolderAggegate),
    total_aggregate_offering: numScalar(summaryInfo.totalAggregateOffering),
    securities_offered: summaryInfo.securitiesOffered,
    outstanding_securities: summaryInfo.outstandingSecurities ?? null,
    estimated_net_amount: numScalar(summaryInfo.estimatedNetAmount),
    crd_number: summaryInfo.brokerDealerCrdNumber ?? null,
  };

  await regARepo.saveOfferingHistory(history);

  await processIssuer(cik, form1A, ctx);
  await processConnection(cik, form1A, ctx);
  await processServiceProviders(cik, file_number, accession_number, form1A, ctx);
  await processFinancialData(cik, file_number, accession_number, form1A);
  await processEquityClasses(cik, file_number, accession_number, form1A);
}
