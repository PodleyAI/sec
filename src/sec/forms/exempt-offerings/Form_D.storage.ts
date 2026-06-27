/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { InvestmentOfferingRepo } from "../../../storage/investment-offering/InvestmentOfferingRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";

import { hasCompanyEnding } from "../../../storage/company/CompanyNormalization";
import { IssuerRepo } from "../../../storage/investment-offering/IssuerRepo";
import { isBadPersonField } from "../../../types/edgar/bad-data";
import { INDEFINITE } from "./Form_D.schema";
import type {
  FormD,
  Issuer,
  OfferingData,
  RelatedPerson,
  Signature,
  SignatureBlock,
} from "./Form_D.schema";
import type { InvestmentOffering } from "../../../storage/investment-offering/InvestmentOfferingSchema";
import type { InvestmentOfferingHistory } from "../../../storage/investment-offering/InvestmentOfferingHistorySchema";
import { parseCikSafely } from "../../../util/parseCik";
import { EntityObserver } from "../../../resolver/EntityObserver";
import { PersonResolver } from "../../../resolver/PersonResolver";
import { CompanyResolver } from "../../../resolver/CompanyResolver";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
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
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";

interface FormDStorageContext {
  readonly accession_number: string;
  readonly extractor_id: "D";
  readonly extractor_version: string;
  readonly observer: EntityObserver;
}

/**
 * Coerce a numeric-shaped string into a finite integer or null. EDGAR-emitted
 * strings can carry stray whitespace or non-digit cruft; `parseInt` would
 * silently swallow trailing junk (e.g. "123abc" → 123). We require the entire
 * trimmed value to be digits (with an optional leading sign) before parsing.
 */
function parseIntegerOrNull(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const trimmed = String(raw).trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

async function safeCall<T>(fn: () => Promise<T>, context: string): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.warn(context, error);
    return null;
  }
}

async function processOffering(
  cik: number,
  file_number: string,
  accession_number: string,
  filing_date: string,
  offering: OfferingData,
  ctx: FormDStorageContext
): Promise<void> {
  const investmentOfferingRepo = new InvestmentOfferingRepo();

  const industryGroup = offering.industryGroup;
  const amounts = offering.offeringSalesAmounts;
  const federalExemptionsExclusions = offering.federalExemptionsExclusions.item;
  const typesOfSecOff = offering.typesOfSecuritiesOffered;

  // Create investment offering record
  const investmentOffering: InvestmentOffering = {
    cik,
    file_number,
    industry_group: industryGroup.industryGroupType,
    industry_subgroup: industryGroup.investmentFundInfo?.investmentFundType || null,
    date_of_first_sale:
      "value" in offering.typeOfFiling.dateOfFirstSale
        ? offering.typeOfFiling.dateOfFirstSale.value
        : null,
    exemptions: federalExemptionsExclusions,
    is_debt_type: typesOfSecOff.isDebtType === "true" ? true : null,
    is_equity_type: typesOfSecOff.isEquityType === "true" ? true : null,
    is_mineral_property_type: typesOfSecOff.isMineralPropertyType === "true" ? true : null,
    is_option_to_aquire_type: typesOfSecOff.isOptionToAcquireType === "true" ? true : null,
    is_pooled_investment_type: typesOfSecOff.isPooledInvestmentFundType === "true" ? true : null,
    is_security_to_be_aquired: typesOfSecOff.isSecurityToBeAcquiredType === "true" ? true : null,
    is_tenant_in_common: typesOfSecOff.isTenantInCommonType === "true" ? true : null,
    is_business_combination_type:
      offering.businessCombinationTransaction.isBusinessCombinationTransaction === "true",
    is_other_type: typesOfSecOff.isOtherType === "true" ? true : null,
    description_of_other: typesOfSecOff.descriptionOfOtherType || null,
    as_of: null,
  };

  const investmentOfferingHistory: InvestmentOfferingHistory = {
    cik,
    file_number,
    accession_number,
    minimum_investment_accepted: offering.minimumInvestmentAccepted,
    total_offering_amount:
      amounts.totalOfferingAmount === INDEFINITE
        ? null
        : parseIntegerOrNull(amounts.totalOfferingAmount),
    total_amount_sold: amounts.totalAmountSold,
    total_remaining:
      amounts.totalRemaining === INDEFINITE ? null : parseIntegerOrNull(amounts.totalRemaining),
    investor_count: offering.investors.totalNumberAlreadyInvested,
    non_accredited_count: offering.investors.numberNonAccreditedInvestors || null,
  };

  // History is per-(cik, file_number, accession) and always recorded — it is
  // the append-only time series. The mutable current row must reflect the
  // latest filing BY FILING DATE, not by processing order: an out-of-order
  // older D / D-A is skipped so a back-catalog replay can't regress
  // industry_group / security-type flags / date_of_first_sale. The read-guard-
  // write is atomic per (cik, file_number) so two filings for the same offering
  // processed concurrently can't lost-update the row. (Each Form D fully
  // restates the offering, so no field-merge is needed — only the date guard.)
  await investmentOfferingRepo.saveInvestmentOfferingHistory(investmentOfferingHistory);
  await investmentOfferingRepo.saveInvestmentOfferingAsOf(investmentOffering, filing_date);

  if (offering.salesCompensationList.recipient) {
    let salesIndex = 100;
    for (const recipient of offering.salesCompensationList.recipient) {
      if (!recipient.recipientName || recipient.recipientName.toLowerCase().trim() === "none") {
        continue;
      }

      await processSalesCompensationRecipient(cik, recipient, ctx, salesIndex);
      salesIndex++;
    }
  }
}

async function processSalesCompensationRecipient(
  cik: number,
  recipient: any,
  ctx: FormDStorageContext,
  index: number
): Promise<void> {
  const addressRepo = new AddressRepo();

  const recipientName = recipient.recipientName;
  const recipientCRD = recipient.recipientCRDNumber;

  // Clean up CRD number - skip if it's "None" or empty
  const cleanCRD = recipientCRD && recipientCRD.toLowerCase() !== "none" ? recipientCRD : null;

  const addr = recipient.recipientAddress
    ? await safeCall(
        () => addressRepo.saveAddress(recipient.recipientAddress),
        `Failed to save address for sales compensation recipient ${recipient.recipientName}:`
      )
    : null;

  if (hasCompanyEnding(recipientName)) {
    await ctx.observer.observeCompany({
      accession_number: ctx.accession_number,
      extractor_id: ctx.extractor_id,
      extractor_version: ctx.extractor_version,
      observation_index: index,
      cik: null,
      crd_number: cleanCRD,
      name: recipientName,
      address_id: addr?.address_hash_id ?? null,
      source_context: JSON.stringify({ relation: "form-d:sales-compensation" }),
    });
  } else {
    await ctx.observer.observePerson({
      accession_number: ctx.accession_number,
      extractor_id: ctx.extractor_id,
      extractor_version: ctx.extractor_version,
      observation_index: index,
      source_filing_issuer_cik: cik,
      last_name: recipientName,
      title: "Sales Compensation Recipient",
      relationship: "form-d:sales-compensation",
      address_id: addr?.address_hash_id ?? null,
      source_context: JSON.stringify({ relation: "form-d:sales-compensation", crd_number: cleanCRD }),
    });
  }
}

async function processIssuer(
  cik: number,
  issuer: Issuer,
  isPrimaryIssuer: boolean,
  ctx: FormDStorageContext,
  index: number
): Promise<void> {
  const addressRepo = new AddressRepo();
  const phoneRepo = new PhoneRepo();
  const issuerRepo = new IssuerRepo();

  const companyName = issuer.entityName || `Entity ${issuer.cik}`;

  let country_code = "US";
  let addr: Awaited<ReturnType<typeof addressRepo.saveAddress>> | null = null;
  let phone: Awaited<ReturnType<typeof phoneRepo.savePhone>> | null = null;

  const issuerCik = parseCikSafely(issuer.cik);
  if (issuerCik !== cik) {
    const issuerRecord = {
      cik,
      issuer_cik: issuerCik,
      is_primary: isPrimaryIssuer,
    };
    await issuerRepo.saveIssuer(issuerRecord);
  }

  try {
    addr = await addressRepo.saveAddress(issuer.issuerAddress);
    if (addr?.country_code) {
      country_code = addr.country_code;
    }
  } catch (error) {
    console.warn(`Failed to save address for issuer ${companyName}:`, issuer.issuerAddress, error);
  }

  try {
    phone = await phoneRepo.savePhone({
      phone_raw: issuer.issuerPhoneNumber,
      country_code,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Failed to save phone "${issuer.issuerPhoneNumber}" for issuer ${companyName}: ${message}`
    );
  }

  await ctx.observer.observeCompany({
    accession_number: ctx.accession_number,
    extractor_id: ctx.extractor_id,
    extractor_version: ctx.extractor_version,
    observation_index: index,
    cik: issuerCik ?? null,
    name: companyName,
    address_id: addr?.address_hash_id ?? null,
    international_number: phone?.international_number ?? null,
    source_context: JSON.stringify({
      relation: isPrimaryIssuer ? "form-d:primary-issuer" : "form-d:additional-issuer",
    }),
  });

}

function isCompanyInPersonField(person: RelatedPerson): boolean {
  return (
    hasCompanyEnding(person.relatedPersonName.firstName) ||
    hasCompanyEnding(person.relatedPersonName.lastName)
  );
}

async function processRelatedPerson(
  cik: number,
  relation_type: string,
  person: RelatedPerson,
  ctx: FormDStorageContext,
  index: number
): Promise<void> {
  const addressRepo = new AddressRepo();
  if (
    isBadPersonField(person.relatedPersonName.firstName) &&
    isBadPersonField(person.relatedPersonName.lastName)
  ) {
    return;
  }

  if (isCompanyInPersonField(person)) {
    const companyName = [
      person.relatedPersonName.firstName,
      person.relatedPersonName.middleName,
      person.relatedPersonName.lastName,
    ]
      .filter((name) => name && !isBadPersonField(name))
      .join(" ");

    if (companyName) {
      let addr: Awaited<ReturnType<typeof addressRepo.saveAddress>> | null = null;
      try {
        addr = await addressRepo.saveAddress(person.relatedPersonAddress);
      } catch (error) {
        console.warn(`Failed to save address for company ${companyName}:`, error);
      }

      await ctx.observer.observeCompany({
        accession_number: ctx.accession_number,
        extractor_id: ctx.extractor_id,
        extractor_version: ctx.extractor_version,
        observation_index: index,
        cik: null,
        name: companyName,
        address_id: addr?.address_hash_id ?? null,
        source_context: JSON.stringify({
          relation: relation_type,
          titles: person.relatedPersonRelationshipList.relationship,
        }),
      });
    }
    return;
  }

  let addr: Awaited<ReturnType<typeof addressRepo.saveAddress>> | null = null;
  try {
    addr = await addressRepo.saveAddress(person.relatedPersonAddress);
  } catch (error) {
    const fullName = [
      person.relatedPersonName.firstName,
      person.relatedPersonName.middleName,
      person.relatedPersonName.lastName,
    ]
      .filter(Boolean)
      .join(" ");
    console.warn(`Failed to save address for person ${fullName}:`, error);
  }

  await ctx.observer.observePerson({
    accession_number: ctx.accession_number,
    extractor_id: ctx.extractor_id,
    extractor_version: ctx.extractor_version,
    observation_index: index,
    source_filing_issuer_cik: cik,
    first_name: person.relatedPersonName.firstName || null,
    middle_name: person.relatedPersonName.middleName || null,
    last_name: person.relatedPersonName.lastName || null,
    relationship: relation_type,
    address_id: addr?.address_hash_id ?? null,
    source_context: JSON.stringify({
      relation: relation_type,
      titles: person.relatedPersonRelationshipList.relationship,
    }),
  });
}

async function processSignature(
  cik: number,
  signature: Signature,
  authorizedRepresentative: boolean = false,
  ctx: FormDStorageContext,
  index: number
): Promise<void> {
  const signerName = signature.signatureName || signature.nameOfSigner;
  const signatureTitle = signature.signatureTitle;

  if (!signerName) {
    console.warn("Signature missing signer name, skipping");
    return;
  }

  const relationshipTitles = [signatureTitle || "Signer"];
  if (authorizedRepresentative) {
    relationshipTitles.push("Authorized Representative");
  }
  const cleanTitles = relationshipTitles.filter(Boolean);

  if (hasCompanyEnding(signerName)) {
    await ctx.observer.observeCompany({
      accession_number: ctx.accession_number,
      extractor_id: ctx.extractor_id,
      extractor_version: ctx.extractor_version,
      observation_index: index,
      cik: null,
      name: signerName,
      source_context: JSON.stringify({ relation: "form-d:signature", titles: cleanTitles }),
    });
  } else {
    await ctx.observer.observePerson({
      accession_number: ctx.accession_number,
      extractor_id: ctx.extractor_id,
      extractor_version: ctx.extractor_version,
      observation_index: index,
      source_filing_issuer_cik: cik,
      last_name: signerName,
      title: cleanTitles[0] ?? null,
      relationship: "form-d:signature",
      source_context: JSON.stringify({ relation: "form-d:signature", titles: cleanTitles }),
    });
  }
}

async function processSignatureBlock(
  cik: number,
  signatureBlock: SignatureBlock,
  ctx: FormDStorageContext,
  startIndex: number
): Promise<void> {
  if (!signatureBlock || !signatureBlock.signature) {
    return;
  }

  const authorizedRepresentative = signatureBlock.authorizedRepresentative === "true";

  const signatures: Signature[] = Array.isArray(signatureBlock.signature)
    ? signatureBlock.signature
    : [signatureBlock.signature];

  let idx = startIndex;
  for (const signature of signatures) {
    try {
      await processSignature(cik, signature, authorizedRepresentative, ctx, idx);
      idx++;
    } catch (error) {
      console.warn(`Failed to process signature:`, signature, error);
    }
  }
}

export async function processFormD({
  cik,
  file_number,
  accession_number,
  filing_date,
  primary_doc,
  formD,
}: {
  cik: number;
  file_number: string;
  accession_number: string;
  filing_date: string;
  primary_doc: string;
  formD: FormD;
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

  const extractor_version = "1.0.0";

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
    companyObservationRepo,
    personIdentityLinkRepo,
    companyIdentityLinkRepo,
    personResolver,
    companyResolver,
    canonicalPersonAddressRepo,
    canonicalPersonPhoneRepo,
    canonicalCompanyAddressRepo,
    canonicalCompanyPhoneRepo,
    activeResolverPersonVersion,
    activeResolverCompanyVersion,
  });

  const ctx: FormDStorageContext = {
    accession_number,
    extractor_id: "D",
    extractor_version,
    observer,
  };

  // Issuers: indices 0–99
  let issuerIndex = 0;
  await processIssuer(cik, formD.primaryIssuer, true, ctx, issuerIndex++);
  for (const issuer of formD.issuerList?.issuer || []) {
    await processIssuer(cik, issuer, false, ctx, issuerIndex++);
  }

  // Sales compensation: indices 100–199 (handled inside processOffering)
  await processOffering(cik, file_number, accession_number, filing_date, formD.offeringData, ctx);

  // Related persons: indices 200–299
  let relatedPersonIndex = 200;
  for (const person of formD.relatedPersonsList?.relatedPersonInfo || []) {
    await processRelatedPerson(cik, "form-d:related-person", person, ctx, relatedPersonIndex++);
  }

  // Signatures: indices 300–399
  if (formD.offeringData?.signatureBlock) {
    await processSignatureBlock(cik, formD.offeringData.signatureBlock, ctx, 300);
  }
}
