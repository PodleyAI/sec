/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AddressRepo } from "../../../storage/address/AddressRepo";
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { hasCompanyEnding } from "../../../storage/company/CompanyNormalization";
import { PersonRepo } from "../../../storage/person/PersonRepo";
import { CrowdfundingRepo } from "../../../storage/portal/CrowdfundingRepo";
import { CrowdfundingTemporalRepo } from "../../../storage/portal/CrowdfundingTemporalRepo";
import type { Crowdfunding, CrowdfundingOfferings, CrowdfundingReports } from "../../../storage/portal/CrowdfundingSchema";
import { isBadPersonField } from "../../../types/edgar/bad-data";
import type { FormC } from "./Form_C.schema";
import { parseCikSafely } from "../../../util/parseCik";

const RELATION_TYPE_ISSUER = "form-c:issuer";
const RELATION_TYPE_CO_ISSUER = "form-c:co-issuer";
const RELATION_TYPE_SIGNATURE = "form-c:signature";

/**
 * Parse a compensation/financial interest string to extract a percentage and detail text.
 * Examples: "5%", "5.00% of total offering amount", "See description below"
 */
function parsePercentAndDetail(raw: string | undefined): {
  percent: number | null;
  detail: string | null;
} {
  if (!raw) return { percent: null, detail: null };
  const trimmed = raw.trim();
  // Try to extract a percentage value
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*%/);
  if (match) {
    const pct = parseFloat(match[1]) / 100;
    const rest = trimmed.slice(match[0].length).trim();
    return { percent: pct, detail: rest || null };
  }
  // No percentage found, treat entire string as detail
  return { percent: null, detail: trimmed || null };
}

function determineStatus(submissionType: string): string {
  if (submissionType.includes("/A")) return "amended";
  if (submissionType.startsWith("C-AR")) return "annual-report";
  if (submissionType.startsWith("C-TR")) return "termination";
  if (submissionType.includes("-W")) return "withdrawn";
  if (submissionType.includes("-U")) return "progress-update";
  return "active";
}

async function processIssuer(cik: number, formC: FormC): Promise<void> {
  const companyRepo = new CompanyRepo();
  const addressRepo = new AddressRepo();

  const issuerInfo = formC.formData.issuerInformation.issuerInfo;
  const company = await companyRepo.saveCompany(issuerInfo.nameOfIssuer);
  await companyRepo.saveRelatedEntity(company.company_hash_id, RELATION_TYPE_ISSUER, cik, [
    "Issuer",
  ]);

  if (issuerInfo.issuerAddress) {
    try {
      const address = await addressRepo.saveAddress(issuerInfo.issuerAddress);
      await addressRepo.saveRelatedEntity(address.address_hash_id, RELATION_TYPE_ISSUER, cik);
      await companyRepo.saveRelatedAddress(
        company.company_hash_id,
        RELATION_TYPE_ISSUER,
        address.address_hash_id
      );
    } catch (error) {
      console.warn(
        `Failed to save address for Form C issuer ${issuerInfo.nameOfIssuer}:`,
        error
      );
    }
  }
}

async function processCoIssuers(cik: number, formC: FormC): Promise<void> {
  const coIssuers = formC.formData.issuerInformation.coIssuers?.coIssuerInfo;
  if (!coIssuers) return;

  const companyRepo = new CompanyRepo();
  const addressRepo = new AddressRepo();

  for (const coIssuer of coIssuers) {
    if (!coIssuer.nameOfCoIssuer) continue;

    const company = await companyRepo.saveCompany(coIssuer.nameOfCoIssuer);
    await companyRepo.saveRelatedEntity(company.company_hash_id, RELATION_TYPE_CO_ISSUER, cik, [
      "Co-Issuer",
    ]);

    if (coIssuer.coIssuerAddress) {
      try {
        const address = await addressRepo.saveAddress(coIssuer.coIssuerAddress);
        await addressRepo.saveRelatedEntity(
          address.address_hash_id,
          RELATION_TYPE_CO_ISSUER,
          cik
        );
        await companyRepo.saveRelatedAddress(
          company.company_hash_id,
          RELATION_TYPE_CO_ISSUER,
          address.address_hash_id
        );
      } catch (error) {
        console.warn(
          `Failed to save address for Form C co-issuer ${coIssuer.nameOfCoIssuer}:`,
          error
        );
      }
    }
  }
}

async function processSignatures(cik: number, formC: FormC): Promise<void> {
  const companyRepo = new CompanyRepo();
  const personRepo = new PersonRepo();
  const signatureInfo = formC.formData.signatureInfo;

  // Issuer signature
  const issuerSig = signatureInfo.issuerSignature;
  if (issuerSig.issuerSignature && !isBadPersonField(issuerSig.issuerSignature)) {
    const sigName = issuerSig.issuerSignature;
    const titles = [issuerSig.issuerTitle || "Signer"];

    if (hasCompanyEnding(sigName)) {
      const company = await companyRepo.saveCompany(sigName);
      await companyRepo.saveRelatedEntity(
        company.company_hash_id,
        RELATION_TYPE_SIGNATURE,
        cik,
        titles
      );
    } else {
      const person = await personRepo.savePerson({ name: sigName });
      await personRepo.saveRelatedEntity(
        person.person_hash_id,
        RELATION_TYPE_SIGNATURE,
        cik,
        titles
      );
    }
  }

  // Signature persons
  if (signatureInfo.signaturePersons?.signaturePerson) {
    for (const sp of signatureInfo.signaturePersons.signaturePerson) {
      if (isBadPersonField(sp.personSignature)) continue;

      const sigName = sp.personSignature;
      const titles = [sp.personTitle || "Signer"];

      if (hasCompanyEnding(sigName)) {
        const company = await companyRepo.saveCompany(sigName);
        await companyRepo.saveRelatedEntity(
          company.company_hash_id,
          RELATION_TYPE_SIGNATURE,
          cik,
          titles
        );
      } else {
        const person = await personRepo.savePerson({ name: sigName });
        await personRepo.saveRelatedEntity(
          person.person_hash_id,
          RELATION_TYPE_SIGNATURE,
          cik,
          titles
        );
      }
    }
  }
}

async function processOfferingInfo(
  cik: number,
  file_number: string,
  filing_date: string,
  formC: FormC
): Promise<void> {
  const crowdfundingRepo = new CrowdfundingRepo();
  const offeringInfo = formC.formData.offeringInformation;
  if (!offeringInfo) return;

  const compAmount = parsePercentAndDetail(offeringInfo.compensationAmount);
  const finInterest = parsePercentAndDetail(offeringInfo.financialInterest);

  const offering: CrowdfundingOfferings = {
    cik,
    file_number,
    filing_date,
    compensation_amount_percent: compAmount.percent,
    compensation_amount_detail: compAmount.detail,
    financial_interest_percent: finInterest.percent,
    financial_interest_detail: finInterest.detail,
    security_offered_type: offeringInfo.securityOfferedType ?? null,
    no_of_security_offered: offeringInfo.noOfSecurityOffered ?? null,
    price: offeringInfo.price ?? null,
    price_determination_method: offeringInfo.priceDeterminationMethod ?? null,
    offering_amount: offeringInfo.offeringAmount ?? null,
    maximum_offering_amount: offeringInfo.maximumOfferingAmount ?? null,
    over_subscription_accepted: offeringInfo.overSubscriptionAccepted ?? null,
    deadline_date: offeringInfo.deadlineDate ?? null,
  };

  await crowdfundingRepo.saveCrowdfundingOffering(offering);
}

async function processAnnualReportDisclosures(
  cik: number,
  file_number: string,
  filing_date: string,
  formC: FormC
): Promise<void> {
  const crowdfundingRepo = new CrowdfundingRepo();
  const disclosures = formC.formData.annualReportDisclosureRequirements;
  if (!disclosures) return;

  const fields: Array<[string, number | undefined]> = [
    ["currentEmployees", disclosures.currentEmployees],
    ["totalAssetMostRecentFiscalYear", disclosures.totalAssetMostRecentFiscalYear],
    ["totalAssetPriorFiscalYear", disclosures.totalAssetPriorFiscalYear],
    ["cashEquiMostRecentFiscalYear", disclosures.cashEquiMostRecentFiscalYear],
    ["cashEquiPriorFiscalYear", disclosures.cashEquiPriorFiscalYear],
    ["actReceivedMostRecentFiscalYear", disclosures.actReceivedMostRecentFiscalYear],
    ["actReceivedPriorFiscalYear", disclosures.actReceivedPriorFiscalYear],
    ["shortTermDebtMostRecentFiscalYear", disclosures.shortTermDebtMostRecentFiscalYear],
    ["shortTermDebtPriorFiscalYear", disclosures.shortTermDebtPriorFiscalYear],
    ["longTermDebtMostRecentFiscalYear", disclosures.longTermDebtMostRecentFiscalYear],
    ["longTermDebtPriorFiscalYear", disclosures.longTermDebtPriorFiscalYear],
    ["revenueMostRecentFiscalYear", disclosures.revenueMostRecentFiscalYear],
    ["revenuePriorFiscalYear", disclosures.revenuePriorFiscalYear],
    ["costGoodsSoldMostRecentFiscalYear", disclosures.costGoodsSoldMostRecentFiscalYear],
    ["costGoodsSoldPriorFiscalYear", disclosures.costGoodsSoldPriorFiscalYear],
    ["taxPaidMostRecentFiscalYear", disclosures.taxPaidMostRecentFiscalYear],
    ["taxPaidPriorFiscalYear", disclosures.taxPaidPriorFiscalYear],
    ["netIncomeMostRecentFiscalYear", disclosures.netIncomeMostRecentFiscalYear],
    ["netIncomePriorFiscalYear", disclosures.netIncomePriorFiscalYear],
  ];

  for (const [name, value] of fields) {
    if (value === undefined) continue;
    const report: CrowdfundingReports = {
      cik,
      file_number,
      filing_date,
      disclosure_name: name,
      disclosure_value: value,
    };
    await crowdfundingRepo.saveCrowdfundingReport(report);
  }
}

export async function processFormC({
  cik,
  file_number,
  accession_number,
  filing_date,
  primary_doc,
  formC,
}: {
  cik: number;
  file_number: string;
  accession_number: string;
  filing_date: string;
  primary_doc: string;
  formC: FormC;
}): Promise<void> {
  const temporalRepo = new CrowdfundingTemporalRepo();

  const issuerInfo = formC.formData.issuerInformation;
  const issuer = issuerInfo.issuerInfo;
  const submissionType = formC.headerData.submissionType;

  const crowdfunding: Crowdfunding = {
    cik,
    file_number,
    filing_date,
    name: issuer.nameOfIssuer,
    legal_status: issuer.legalStatus?.legalStatusForm ?? "",
    state_jurisdiction: issuer.legalStatus?.jurisdictionOrganization ?? "",
    date_incorporation: issuer.legalStatus?.dateIncorporation ?? "",
    url: issuer.issuerWebsite ?? "",
    portal_cik: parseCikSafely(issuerInfo.commissionCik),
    status: determineStatus(submissionType),
  };

  await temporalRepo.saveCrowdfundingWithHistory(crowdfunding, `Form ${submissionType}`);
  await processIssuer(cik, formC);
  await processCoIssuers(cik, formC);
  await processOfferingInfo(cik, file_number, filing_date, formC);
  await processAnnualReportDisclosures(cik, file_number, filing_date, formC);
  await processSignatures(cik, formC);
}
