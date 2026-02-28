/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AddressRepo } from "../../../storage/address/AddressRepo";
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import type { RegAOffering } from "../../../storage/reg-a/RegAOfferingSchema";
import type { RegAOfferingHistory } from "../../../storage/reg-a/RegAOfferingHistorySchema";
import {
  extractServiceProviders,
  RELATION_TYPE_REGA_ISSUER,
  RELATION_TYPE_REGA_SERVICE_PROVIDER,
} from "./RegA_shared";
import type { Form1K } from "./Form_1_K.schema";

async function processIssuer(cik: number, form1K: Form1K): Promise<void> {
  const companyRepo = new CompanyRepo();
  const addressRepo = new AddressRepo();
  const phoneRepo = new PhoneRepo();

  const item1Info = form1K.formData.item1Info;
  const item1 = form1K.formData.item1;

  // Process each issuer in item1Info
  for (const issuer of item1Info) {
    if (!issuer.issuerName) continue;

    const company = await companyRepo.saveCompany(issuer.issuerName);
    await companyRepo.saveRelatedEntity(
      company.company_hash_id,
      RELATION_TYPE_REGA_ISSUER,
      cik,
      ["Issuer"]
    );
  }

  // Use item1 for address and phone (shared across all issuers)
  try {
    const address = await addressRepo.saveAddress({
      street1: item1.street1,
      street2: item1.street2,
      city: item1.city,
      stateOrCountry: item1.stateOrCountry,
      zipCode: item1.zipCode,
    });
    await addressRepo.saveRelatedEntity(address.address_hash_id, RELATION_TYPE_REGA_ISSUER, cik);
  } catch (error) {
    console.warn(`Failed to save address for Form 1-K issuer:`, error);
  }

  const phone = await phoneRepo.savePhone({
    phone_raw: item1.phoneNumber,
    country_code: item1.stateOrCountry?.length === 2 ? "US" : item1.stateOrCountry,
  });
  await phoneRepo.saveRelatedEntity(phone.international_number, RELATION_TYPE_REGA_ISSUER, cik);
}

async function processOfferingHistory(
  cik: number,
  file_number: string,
  accession_number: string,
  filing_date: string,
  form1K: Form1K
): Promise<void> {
  const regARepo = new RegAOfferingRepo();
  const companyRepo = new CompanyRepo();
  const summaryInfoArr = form1K.formData.summaryInfo;
  if (!summaryInfoArr) return;

  for (const summaryInfo of summaryInfoArr) {
    // Use the commission file number from summary if available, otherwise fall back
    const offeringFileNumber = summaryInfo.commissionFileNumber ?? file_number;

    const history: RegAOfferingHistory = {
      cik,
      file_number: offeringFileNumber,
      accession_number,
      filing_date,
      qualification_date: summaryInfo.offeringQualificationDate ?? null,
      commence_date: summaryInfo.offeringCommenceDate ?? null,
      securities_qualified_sold: summaryInfo.qualifiedSecuritiesSold ?? null,
      securities_sold: summaryInfo.offeringSecuritiesSold ?? null,
      price_per_security: summaryInfo.pricePerSecurity ?? null,
      aggregate_offering_price: summaryInfo.aggregrateOfferingPrice ?? null,
      aggregate_offering_price_holders: summaryInfo.aggregrateOfferingPriceHolders ?? null,
      issuer_aggregate_offering: null,
      security_holder_aggregate: null,
      total_aggregate_offering: null,
      securities_offered: null,
      outstanding_securities: null,
      estimated_net_amount: summaryInfo.issuerNetProceeds ?? null,
      crd_number: summaryInfo.crdNumberBrokerDealer ?? null,
    };

    await regARepo.saveOfferingHistory(history);

    // Process service providers for this offering
    const providers = extractServiceProviders(summaryInfo as Record<string, unknown>, "1-K");
    for (const provider of providers) {
      await regARepo.saveServiceProvider({
        cik,
        file_number: offeringFileNumber,
        accession_number,
        provider_type: provider.type,
        provider_name: provider.name,
        fees: provider.fees,
        crd: provider.crd,
      });

      if (provider.name) {
        const company = await companyRepo.saveCompany(provider.name);
        await companyRepo.saveRelatedEntity(
          company.company_hash_id,
          RELATION_TYPE_REGA_SERVICE_PROVIDER,
          cik,
          [provider.type]
        );
      }
    }
  }
}

export async function processForm1K({
  cik,
  file_number,
  accession_number,
  filing_date,
  primary_doc,
  form1K,
}: {
  cik: number;
  file_number: string;
  accession_number: string;
  filing_date: string;
  primary_doc: string;
  form1K: Form1K;
}): Promise<void> {
  const regARepo = new RegAOfferingRepo();

  const item1Info = form1K.formData.item1Info;
  const primaryIssuer = item1Info[0];

  // Upsert the offering
  const offering: RegAOffering = {
    cik,
    file_number,
    issuer_name: primaryIssuer?.issuerName ?? null,
    jurisdiction: primaryIssuer?.jurisdictionOrganization ?? null,
    sic_code: null,
    tier: null,
    financial_statement_audit_status: null,
    securities_offered_type: null,
    industry_group: null,
    status: "reporting",
  };

  await regARepo.saveOffering(offering);

  await processIssuer(cik, form1K);
  await processOfferingHistory(cik, file_number, accession_number, filing_date, form1K);
}
