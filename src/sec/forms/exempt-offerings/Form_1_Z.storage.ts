/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AddressRepo } from "../../../storage/address/AddressRepo";
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { hasCompanyEnding } from "../../../storage/company/CompanyNormalization";
import { PersonRepo } from "../../../storage/person/PersonRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import type { RegAOffering } from "../../../storage/reg-a/RegAOfferingSchema";
import type { RegAOfferingHistory } from "../../../storage/reg-a/RegAOfferingHistorySchema";
import type { RegAFinancialData } from "../../../storage/reg-a/RegAFinancialDataSchema";
import {
  extractServiceProviders,
  RELATION_TYPE_REGA_ISSUER,
  RELATION_TYPE_REGA_SERVICE_PROVIDER,
  RELATION_TYPE_REGA_SIGNATURE,
} from "./RegA_shared";
import type { Form1Z } from "./Form_1_Z.schema";

async function processIssuerAndAddress(cik: number, form1Z: Form1Z): Promise<void> {
  const companyRepo = new CompanyRepo();
  const addressRepo = new AddressRepo();
  const phoneRepo = new PhoneRepo();

  const item1 = form1Z.formData.item1;

  const company = await companyRepo.saveCompany(item1.issuerName);
  await companyRepo.saveRelatedEntity(
    company.company_hash_id,
    RELATION_TYPE_REGA_ISSUER,
    cik,
    ["Issuer"]
  );

  try {
    const address = await addressRepo.saveAddress({
      street1: item1.street1,
      street2: item1.street2,
      city: item1.city,
      stateOrCountry: item1.stateOrCountry,
      zipCode: item1.zipCode,
    });
    await addressRepo.saveRelatedEntity(address.address_hash_id, RELATION_TYPE_REGA_ISSUER, cik);
    await companyRepo.saveRelatedAddress(
      company.company_hash_id,
      RELATION_TYPE_REGA_ISSUER,
      address.address_hash_id
    );
  } catch (error) {
    console.warn(`Failed to save address for Form 1-Z issuer ${item1.issuerName}:`, error);
  }

  const phone = await phoneRepo.savePhone({
    phone_raw: item1.phone,
    country_code: item1.stateOrCountry?.length === 2 ? "US" : item1.stateOrCountry,
  });
  await phoneRepo.saveRelatedEntity(phone.international_number, RELATION_TYPE_REGA_ISSUER, cik);
  await companyRepo.saveRelatedPhone(
    phone.international_number,
    RELATION_TYPE_REGA_ISSUER,
    company.company_hash_id
  );
}

async function processOfferingSummaries(
  cik: number,
  file_number: string,
  accession_number: string,
  filing_date: string,
  form1Z: Form1Z
): Promise<void> {
  const regARepo = new RegAOfferingRepo();
  const companyRepo = new CompanyRepo();
  const summaryInfoArr = form1Z.formData.summaryInfoOffering;
  if (!summaryInfoArr) return;

  for (const summaryInfo of summaryInfoArr) {
    // Skip empty/non-object entries (from self-closing XML tags)
    if (typeof summaryInfo !== "object" || summaryInfo === null) continue;

    const history: RegAOfferingHistory = {
      cik,
      file_number,
      accession_number,
      filing_date,
      qualification_date: summaryInfo.offeringQualificationDate ?? null,
      commence_date: summaryInfo.offeringCommenceDate ?? null,
      securities_qualified_sold: summaryInfo.offeringSecuritiesQualifiedSold ?? null,
      securities_sold: summaryInfo.offeringSecuritiesSold ?? null,
      price_per_security: summaryInfo.pricePerSecurity ?? null,
      aggregate_offering_price: summaryInfo.portionSecuritiesSoldIssuer ?? null,
      aggregate_offering_price_holders: summaryInfo.portionSecuritiesSoldSecurityholders ?? null,
      issuer_aggregate_offering: null,
      security_holder_aggregate: null,
      total_aggregate_offering: null,
      securities_offered: null,
      outstanding_securities: null,
      estimated_net_amount: summaryInfo.issuerNetProceeds ?? null,
      crd_number: summaryInfo.crdNumberBrokerDealer ?? null,
    };

    await regARepo.saveOfferingHistory(history);

    // 1-Z service provider names are arrays
    const providers = extractServiceProviders(summaryInfo as Record<string, unknown>, "1-Z");
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

async function processCertificationSuspension(
  cik: number,
  file_number: string,
  accession_number: string,
  form1Z: Form1Z
): Promise<void> {
  const regARepo = new RegAOfferingRepo();
  const certifications = form1Z.formData.certificationSuspension;
  if (!certifications) return;

  for (let i = 0; i < certifications.length; i++) {
    const cert = certifications[i];

    if (cert.securitiesClassTitle) {
      const data: RegAFinancialData = {
        cik,
        file_number,
        accession_number,
        field_name: `suspension_${i}_securitiesClassTitle`,
        field_value: null,
      };
      await regARepo.saveFinancialData(data);
    }

    if (cert.approxRecordHolders !== undefined) {
      const data: RegAFinancialData = {
        cik,
        file_number,
        accession_number,
        field_name: `suspension_${i}_approxRecordHolders`,
        field_value: cert.approxRecordHolders,
      };
      await regARepo.saveFinancialData(data);
    }
  }
}

async function processSignatures(cik: number, form1Z: Form1Z): Promise<void> {
  const companyRepo = new CompanyRepo();
  const personRepo = new PersonRepo();

  for (const sig of form1Z.formData.signatureTab) {
    let signerName: string | undefined = undefined;
    if (typeof sig.signatureBy === "string") {
      signerName = sig.signatureBy;
    } else if (typeof sig.signatureBy === "object" && sig.signatureBy !== null) {
      const obj = sig.signatureBy as Record<string, unknown>;
      signerName = (typeof obj.name === "string" ? obj.name : undefined)
        ?? (Object.values(obj).find((v) => typeof v === "string") as string | undefined);
    }
    if (!signerName) continue;

    // Strip common SEC signature prefixes
    signerName = signerName.replace(/^\/s\/\s*/i, "").trim();
    if (!signerName) continue;

    const titles = [sig.title || "Signer"];

    if (hasCompanyEnding(signerName)) {
      const company = await companyRepo.saveCompany(signerName);
      await companyRepo.saveRelatedEntity(
        company.company_hash_id,
        RELATION_TYPE_REGA_SIGNATURE,
        cik,
        titles
      );
    } else {
      try {
        const person = await personRepo.savePerson({ name: signerName });
        await personRepo.saveRelatedEntity(
          person.person_hash_id,
          RELATION_TYPE_REGA_SIGNATURE,
          cik,
          titles
        );
      } catch (error) {
        console.warn(`Failed to normalize signature person ${signerName}:`, error);
      }
    }
  }
}

export async function processForm1Z({
  cik,
  file_number,
  accession_number,
  filing_date,
  primary_doc,
  form1Z,
}: {
  cik: number;
  file_number: string;
  accession_number: string;
  filing_date: string;
  primary_doc: string;
  form1Z: Form1Z;
}): Promise<void> {
  const regARepo = new RegAOfferingRepo();
  const item1 = form1Z.formData.item1;

  const offering: RegAOffering = {
    cik,
    file_number,
    issuer_name: item1.issuerName,
    jurisdiction: null,
    sic_code: null,
    tier: null,
    financial_statement_audit_status: null,
    securities_offered_type: null,
    industry_group: null,
    status: "exit",
  };

  await regARepo.saveOffering(offering);

  await processIssuerAndAddress(cik, form1Z);
  await processOfferingSummaries(cik, file_number, accession_number, filing_date, form1Z);
  await processCertificationSuspension(cik, file_number, accession_number, form1Z);
  await processSignatures(cik, form1Z);
}
