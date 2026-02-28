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
import type { RegAEquityClass } from "../../../storage/reg-a/RegAEquityClassSchema";
import {
  extractServiceProviders,
  RELATION_TYPE_REGA_ISSUER,
  RELATION_TYPE_REGA_SERVICE_PROVIDER,
  RELATION_TYPE_REGA_CONNECTION,
} from "./RegA_shared";
import type { Form1A } from "./Form_1_A.schema";

async function processIssuer(cik: number, form1A: Form1A): Promise<void> {
  const companyRepo = new CompanyRepo();
  const addressRepo = new AddressRepo();
  const phoneRepo = new PhoneRepo();

  const employeesInfo = form1A.formData.employeesInfo[0];
  const issuerInfo = form1A.formData.issuerInfo;

  const company = await companyRepo.saveCompany(employeesInfo.issuerName);
  await companyRepo.saveRelatedEntity(
    company.company_hash_id,
    RELATION_TYPE_REGA_ISSUER,
    cik,
    ["Issuer"]
  );

  // Issuer address
  try {
    const address = await addressRepo.saveAddress({
      street1: issuerInfo.street1,
      street2: issuerInfo.street2,
      city: issuerInfo.city,
      stateOrCountry: issuerInfo.stateOrCountry,
      zipCode: issuerInfo.zipCode,
    });
    await addressRepo.saveRelatedEntity(address.address_hash_id, RELATION_TYPE_REGA_ISSUER, cik);
    await companyRepo.saveRelatedAddress(
      company.company_hash_id,
      RELATION_TYPE_REGA_ISSUER,
      address.address_hash_id
    );
  } catch (error) {
    console.warn(
      `Failed to save address for Form 1-A issuer ${employeesInfo.issuerName}:`,
      error
    );
  }

  // Issuer phone
  const phone = await phoneRepo.savePhone({
    phone_raw: issuerInfo.phoneNumber,
    country_code: issuerInfo.stateOrCountry?.length === 2 ? "US" : issuerInfo.stateOrCountry,
  });
  await phoneRepo.saveRelatedEntity(phone.international_number, RELATION_TYPE_REGA_ISSUER, cik);
  await companyRepo.saveRelatedPhone(
    phone.international_number,
    RELATION_TYPE_REGA_ISSUER,
    company.company_hash_id
  );
}

async function processConnection(cik: number, form1A: Form1A): Promise<void> {
  const issuerInfo = form1A.formData.issuerInfo;
  if (!issuerInfo.connectionName) return;

  const companyRepo = new CompanyRepo();
  const personRepo = new PersonRepo();
  const addressRepo = new AddressRepo();
  const phoneRepo = new PhoneRepo();

  const connectionName = issuerInfo.connectionName;

  if (hasCompanyEnding(connectionName)) {
    const company = await companyRepo.saveCompany(connectionName);
    await companyRepo.saveRelatedEntity(
      company.company_hash_id,
      RELATION_TYPE_REGA_CONNECTION,
      cik,
      ["Connection"]
    );

    if (issuerInfo.connectionStreet1) {
      try {
        const address = await addressRepo.saveAddress({
          street1: issuerInfo.connectionStreet1,
          street2: issuerInfo.connectionStreet2,
          city: issuerInfo.connectionCity,
          stateOrCountry: issuerInfo.connectionStateOrCountry,
          zipCode: issuerInfo.connectionZipCode,
        });
        await addressRepo.saveRelatedEntity(
          address.address_hash_id,
          RELATION_TYPE_REGA_CONNECTION,
          cik
        );
        await companyRepo.saveRelatedAddress(
          company.company_hash_id,
          RELATION_TYPE_REGA_CONNECTION,
          address.address_hash_id
        );
      } catch (error) {
        console.warn(`Failed to save connection address for ${connectionName}:`, error);
      }
    }

    if (issuerInfo.connectionPhoneNumber) {
      const phone = await phoneRepo.savePhone({
        phone_raw: issuerInfo.connectionPhoneNumber,
        country_code: "US",
      });
      await phoneRepo.saveRelatedEntity(
        phone.international_number,
        RELATION_TYPE_REGA_CONNECTION,
        cik
      );
      await companyRepo.saveRelatedPhone(
        phone.international_number,
        RELATION_TYPE_REGA_CONNECTION,
        company.company_hash_id
      );
    }
  } else {
    const person = await personRepo.savePerson({ name: connectionName });
    await personRepo.saveRelatedEntity(
      person.person_hash_id,
      RELATION_TYPE_REGA_CONNECTION,
      cik,
      ["Connection"]
    );

    if (issuerInfo.connectionStreet1) {
      try {
        const address = await addressRepo.saveAddress({
          street1: issuerInfo.connectionStreet1,
          street2: issuerInfo.connectionStreet2,
          city: issuerInfo.connectionCity,
          stateOrCountry: issuerInfo.connectionStateOrCountry,
          zipCode: issuerInfo.connectionZipCode,
        });
        await addressRepo.saveRelatedEntity(
          address.address_hash_id,
          RELATION_TYPE_REGA_CONNECTION,
          cik
        );
        await personRepo.saveRelatedAddress(
          person.person_hash_id,
          RELATION_TYPE_REGA_CONNECTION,
          address.address_hash_id
        );
      } catch (error) {
        console.warn(`Failed to save connection address for ${connectionName}:`, error);
      }
    }

    if (issuerInfo.connectionPhoneNumber) {
      const phone = await phoneRepo.savePhone({
        phone_raw: issuerInfo.connectionPhoneNumber,
        country_code: "US",
      });
      await phoneRepo.saveRelatedEntity(
        phone.international_number,
        RELATION_TYPE_REGA_CONNECTION,
        cik
      );
      await personRepo.saveRelatedPhone(
        phone.international_number,
        RELATION_TYPE_REGA_CONNECTION,
        person.person_hash_id
      );
    }
  }
}

async function processServiceProviders(
  cik: number,
  file_number: string,
  accession_number: string,
  form1A: Form1A
): Promise<void> {
  const regARepo = new RegAOfferingRepo();
  const companyRepo = new CompanyRepo();

  const summaryInfo = form1A.formData.summaryInfo;
  const providers = extractServiceProviders(summaryInfo as Record<string, unknown>, "1-A");

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

async function processFinancialData(
  cik: number,
  file_number: string,
  accession_number: string,
  form1A: Form1A
): Promise<void> {
  const regARepo = new RegAOfferingRepo();
  const issuerInfo = form1A.formData.issuerInfo;

  const fields: Array<[string, number | undefined]> = [
    ["cashEquivalents", issuerInfo.cashEquivalents],
    ["investmentSecurities", issuerInfo.investmentSecurities],
    ["totalInvestments", issuerInfo.totalInvestments],
    ["accountsReceivable", issuerInfo.accountsReceivable],
    ["loans", issuerInfo.loans],
    ["propertyPlantEquipment", issuerInfo.propertyPlantEquipment],
    ["propertyAndEquipment", issuerInfo.propertyAndEquipment],
    ["totalAssets", issuerInfo.totalAssets],
    ["accountsPayable", issuerInfo.accountsPayable],
    ["policyLiabilitiesAndAccruals", issuerInfo.policyLiabilitiesAndAccruals],
    ["deposits", issuerInfo.deposits],
    ["longTermDebt", issuerInfo.longTermDebt],
    ["totalLiabilities", issuerInfo.totalLiabilities],
    ["totalStockholderEquity", issuerInfo.totalStockholderEquity],
    ["totalLiabilitiesAndEquity", issuerInfo.totalLiabilitiesAndEquity],
    ["totalRevenues", issuerInfo.totalRevenues],
    ["totalInterestIncome", issuerInfo.totalInterestIncome],
    ["costAndExpensesApplToRevenues", issuerInfo.costAndExpensesApplToRevenues],
    ["totalInterestExpenses", issuerInfo.totalInterestExpenses],
    ["depreciationAndAmortization", issuerInfo.depreciationAndAmortization],
    ["netIncome", issuerInfo.netIncome],
    ["earningsPerShareBasic", issuerInfo.earningsPerShareBasic],
    ["earningsPerShareDiluted", issuerInfo.earningsPerShareDiluted],
  ];

  for (const [fieldName, fieldValue] of fields) {
    if (fieldValue === undefined) continue;
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
  const regARepo = new RegAOfferingRepo();
  const summaryInfo = form1A.formData.summaryInfo;
  const employeesInfo = form1A.formData.employeesInfo[0];

  const offering: RegAOffering = {
    cik,
    file_number,
    issuer_name: employeesInfo.issuerName,
    jurisdiction: employeesInfo.jurisdictionOrganization,
    sic_code: employeesInfo.sicCode,
    tier: summaryInfo.indicateTier1Tier2Offering,
    financial_statement_audit_status: summaryInfo.financialStatementAuditStatus,
    securities_offered_type: summaryInfo.securitiesOfferedTypes,
    industry_group: form1A.formData.issuerInfo.industryGroup,
    status: "pending",
  };

  await regARepo.saveOffering(offering);

  const history: RegAOfferingHistory = {
    cik,
    file_number,
    accession_number,
    filing_date,
    qualification_date: null,
    commence_date: null,
    securities_qualified_sold: null,
    securities_sold: null,
    price_per_security: summaryInfo.pricePerSecurity ?? null,
    aggregate_offering_price: null,
    aggregate_offering_price_holders: null,
    issuer_aggregate_offering: summaryInfo.issuerAggregateOffering,
    security_holder_aggregate: summaryInfo.securityHolderAggegate,
    total_aggregate_offering: summaryInfo.totalAggregateOffering,
    securities_offered: summaryInfo.securitiesOffered,
    outstanding_securities: summaryInfo.outstandingSecurities ?? null,
    estimated_net_amount: summaryInfo.estimatedNetAmount ?? null,
    crd_number: summaryInfo.brokerDealerCrdNumber ?? null,
  };

  await regARepo.saveOfferingHistory(history);

  await processIssuer(cik, form1A);
  await processConnection(cik, form1A);
  await processServiceProviders(cik, file_number, accession_number, form1A);
  await processFinancialData(cik, file_number, accession_number, form1A);
  await processEquityClasses(cik, file_number, accession_number, form1A);
}
