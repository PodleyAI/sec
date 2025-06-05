//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { AddressRepo } from "../../../storage/address/AddressRepo";
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { InvestmentOfferingRepo } from "../../../storage/investment-offering/InvestmentOfferingRepo";
import { PersonRepo } from "../../../storage/person/PersonRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";

import { hasCompanyEnding } from "../../../storage/company/CompanyNormalization";
import { IssuerRepo } from "../../../storage/investment-offering/IssuerRepo";
import {
  FormD,
  INDEFINITE,
  Issuer,
  OfferingData,
  RelatedPerson,
  Signature,
  SignatureBlock,
} from "./Form_D.schema";
import { InvestmentOffering } from "../../../storage/investment-offering/InvestmentOfferingSchema";
import { InvestmentOfferingHistory } from "../../../storage/investment-offering/InvestmentOfferingHistorySchema";

// relation types for form-d
const RELATION_TYPE_ISSUER = "form-d:issuer";
const RELATION_TYPE_RELATED_PERSON = "form-d:related-person";
const RELATION_TYPE_SALES_COMPENSATION = "form-d:sales-compensation";
const RELATION_TYPE_SIGNATURE = "form-d:signature";

async function processOffering(
  cik: number,
  file_number: string,
  accession_number: string,
  offering: OfferingData
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
  };

  const investmentOfferingHistory: InvestmentOfferingHistory = {
    cik,
    file_number,
    accession_number,
    minimum_investment_accepted: offering.minimumInvestmentAccepted,
    total_offering_amount:
      amounts.totalOfferingAmount === INDEFINITE ? null : parseInt(amounts.totalOfferingAmount),
    total_amount_sold: amounts.totalAmountSold,
    total_remaining:
      amounts.totalRemaining === INDEFINITE ? null : parseInt(amounts.totalRemaining),
    investor_count: offering.investors.totalNumberAlreadyInvested,
    non_accredited_count: offering.investors.numberNonAccreditedInvestors || null,
  };

  await investmentOfferingRepo.saveInvestmentOfferingWithHistory(
    investmentOffering,
    investmentOfferingHistory
  );

  if (offering.salesCompensationList.recipient) {
    for (const recipient of offering.salesCompensationList.recipient) {
      if (!recipient.recipientName || recipient.recipientName.toLowerCase().trim() === "none") {
        continue;
      }

      await processSalesCompensationRecipient(cik, recipient);
    }
  }
}

async function processSalesCompensationRecipient(cik: number, recipient: any): Promise<void> {
  const companyRepo = new CompanyRepo();
  const personRepo = new PersonRepo();
  const addressRepo = new AddressRepo();

  const recipientName = recipient.recipientName;
  const recipientCRD = recipient.recipientCRDNumber;
  const relationName = RELATION_TYPE_SALES_COMPENSATION;
  const relationshipTitles = ["Sales Compensation Recipient"];

  // Clean up CRD number - skip if it's "None" or empty
  const cleanCRD = recipientCRD && recipientCRD.toLowerCase() !== "none" ? recipientCRD : null;

  // Determine if this is a company or person
  if (hasCompanyEnding(recipientName)) {
    const companyImport = {
      company_name: recipientName,
      crd: cleanCRD,
    };
    const company = await companyRepo.saveCompany(companyImport);
    await companyRepo.saveRelatedEntity(
      company.company_hash_id,
      relationName,
      cik,
      relationshipTitles
    );

    // Try to save recipient address
    try {
      const address = await addressRepo.saveAddress(recipient.recipientAddress);
      await addressRepo.saveRelatedEntity(address.address_hash_id, relationName, cik);
      await companyRepo.saveRelatedAddress(
        company.company_hash_id,
        relationName,
        address.address_hash_id
      );
    } catch (error) {
      console.warn(
        `Failed to save address for sales compensation company ${recipientName}:`,
        recipient.recipientAddress,
        error
      );
    }
  } else {
    // Process as person
    const personImport = {
      name: recipientName,
      crd: cleanCRD,
    };
    const savedPerson = await personRepo.savePerson(personImport);
    await personRepo.saveRelatedEntity(
      savedPerson.person_hash_id,
      relationName,
      cik,
      relationshipTitles
    );

    try {
      const address = await addressRepo.saveAddress(recipient.recipientAddress);
      await addressRepo.saveRelatedEntity(address.address_hash_id, relationName, cik);
      await personRepo.saveRelatedAddress(
        savedPerson.person_hash_id,
        relationName,
        address.address_hash_id
      );
    } catch (error) {
      console.warn(
        `Failed to save address for sales compensation person ${recipientName}:`,
        recipient.recipientAddress,
        error
      );
    }
  }
}

function isBadPersonField(field: string | undefined): boolean {
  const baddies = [
    "n/a",
    "na",
    "Managing Member",
    "(entity)",
    "[entity]",
    "entity",
    "none",
    "(none)",
    "[none]",
    "-",
    "--",
    "---",
    "----",
    ".",
    "..",
    "...",
    "....",
    "_",
    "__",
    "___",
    "____",
    "a Delaware limited liability company",
  ];
  if (!field) return true;
  const fieldLower = String(field).toLowerCase().trim();
  if (baddies.includes(fieldLower)) return true;

  return false;
}

async function processIssuer(cik: number, issuer: Issuer, isPrimaryIssuer: boolean): Promise<void> {
  // Repository instances
  const companyRepo = new CompanyRepo();
  const addressRepo = new AddressRepo();
  const phoneRepo = new PhoneRepo();
  const issuerRepo = new IssuerRepo();

  const companyName = issuer.entityName || `Entity ${issuer.cik}`;
  const company = await companyRepo.saveCompany(companyName);
  // Save relationship between this entity and the issuer
  const relationName = isPrimaryIssuer ? "form-d:primary-issuer" : "form-d:additional-issuer";
  await companyRepo.saveRelatedEntity(company.company_hash_id, relationName, cik, [
    isPrimaryIssuer ? "Primary Issuer" : "Additional Issuer",
  ]);

  let country_code = "US";

  // Save the issuer record only if it's not a self-reference
  // (primary issuer typically has the same CIK as the filing entity)
  const issuerCik = parseInt(issuer.cik.toString());
  if (issuerCik !== cik) {
    const issuerRecord = {
      cik,
      issuer_cik: issuerCik,
      is_primary: isPrimaryIssuer,
    };
    await issuerRepo.saveIssuer(issuerRecord);
    await companyRepo.saveRelatedEntity(company.company_hash_id, RELATION_TYPE_ISSUER, issuerCik, [
      "Issuer",
    ]);
  }

  try {
    const address = await addressRepo.saveAddress(issuer.issuerAddress);
    await addressRepo.saveRelatedEntity(address.address_hash_id, relationName, cik);
    if (address.country_code) {
      country_code = address.country_code;
    }
    await companyRepo.saveRelatedAddress(
      company.company_hash_id,
      relationName,
      address.address_hash_id
    );
  } catch (error) {
    console.warn(`Failed to save address for issuer ${companyName}:`, issuer.issuerAddress, error);
  }

  const phone = await phoneRepo.savePhone({
    phone_raw: issuer.issuerPhoneNumber,
    country_code,
  });
  await phoneRepo.saveRelatedEntity(phone.international_number, relationName, cik);
  await companyRepo.saveRelatedPhone(
    phone.international_number,
    relationName,
    company.company_hash_id
  );

  if (issuer.issuerPreviousNameList && "previousName" in issuer.issuerPreviousNameList) {
    for (const prevName of issuer.issuerPreviousNameList.previousName || []) {
      await companyRepo.savePreviousName(company.company_hash_id, prevName, "issuer", "Form D");
    }
  }

  if (issuer.edgarPreviousNameList && "previousName" in issuer.edgarPreviousNameList) {
    for (const prevName of issuer.edgarPreviousNameList.previousName || []) {
      await companyRepo.savePreviousName(company.company_hash_id, prevName, "edgar", "Form D");
    }
  }
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
  person: RelatedPerson
): Promise<void> {
  const companyRepo = new CompanyRepo();
  const personRepo = new PersonRepo();
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
      const company = await companyRepo.saveCompany(companyName);
      await companyRepo.saveRelatedEntity(
        company.company_hash_id,
        relation_type,
        cik,
        person.relatedPersonRelationshipList.relationship
      );

      try {
        const address = await addressRepo.saveAddress(person.relatedPersonAddress);
        await addressRepo.saveRelatedEntity(address.address_hash_id, relation_type, cik);
        await companyRepo.saveRelatedAddress(
          company.company_hash_id,
          relation_type,
          address.address_hash_id
        );
      } catch (error) {
        console.warn(`Failed to save address for company ${companyName}:`, error);
      }
    }
    return;
  }

  const personFullName = [
    person.relatedPersonName.firstName,
    person.relatedPersonName.middleName,
    person.relatedPersonName.lastName,
  ]
    .filter(Boolean)
    .join(" ");

  const savedPerson = await personRepo.savePerson({ name: personFullName });

  const titles = person.relatedPersonRelationshipList.relationship;
  await personRepo.saveRelatedEntity(savedPerson.person_hash_id, relation_type, cik, titles);

  try {
    const address = await addressRepo.saveAddress(person.relatedPersonAddress);
    await addressRepo.saveRelatedEntity(address.address_hash_id, relation_type, cik);
    await personRepo.saveRelatedAddress(
      savedPerson.person_hash_id,
      relation_type,
      address.address_hash_id
    );
  } catch (error) {
    console.warn(`Failed to save address for person ${personFullName}:`, error);
  }
}

async function processSignature(
  cik: number,
  signature: Signature,
  authorizedRepresentative: boolean = false
): Promise<void> {
  const companyRepo = new CompanyRepo();
  const personRepo = new PersonRepo();

  const signerName = signature.signatureName || signature.nameOfSigner;
  const signatureTitle = signature.signatureTitle;
  const signatureDate = signature.signatureDate;
  const issuerName = signature.issuerName;

  if (!signerName) {
    console.warn("Signature missing signer name, skipping");
    return;
  }

  // Determine relationship titles - include signature title and whether they're authorized rep
  const relationshipTitles = [signatureTitle || "Signer"];
  if (authorizedRepresentative) {
    relationshipTitles.push("Authorized Representative");
  }

  // Clean up empty/null titles
  const cleanTitles = relationshipTitles.filter(Boolean);

  // Signature names are almost always individual people signing on behalf of entities
  if (hasCompanyEnding(signerName)) {
    const company = await companyRepo.saveCompany(signerName);
    await companyRepo.saveRelatedEntity(
      company.company_hash_id,
      RELATION_TYPE_SIGNATURE,
      cik,
      cleanTitles
    );
  } else {
    const savedPerson = await personRepo.savePerson({ name: signerName });
    await personRepo.saveRelatedEntity(
      savedPerson.person_hash_id,
      RELATION_TYPE_SIGNATURE,
      cik,
      cleanTitles
    );
  }
}

async function processSignatureBlock(cik: number, signatureBlock: SignatureBlock): Promise<void> {
  if (!signatureBlock || !signatureBlock.signature) {
    return;
  }

  const authorizedRepresentative = signatureBlock.authorizedRepresentative === "true";

  // Handle both single signature and array of signatures
  const signatures: Signature[] = Array.isArray(signatureBlock.signature)
    ? signatureBlock.signature
    : [signatureBlock.signature];

  for (const signature of signatures) {
    try {
      await processSignature(cik, signature, authorizedRepresentative);
    } catch (error) {
      console.warn(`Failed to process signature:`, signature, error);
      // Continue processing other signatures
    }
  }
}

export async function processFormD({
  cik,
  file_number,
  accession_number,
  primary_doc,
  formD,
}: {
  cik: number;
  file_number: string;
  accession_number: string;
  primary_doc: string;
  formD: FormD;
}): Promise<void> {
  await processOffering(cik, file_number, accession_number, formD.offeringData);
  await processIssuer(cik, formD.primaryIssuer, true);
  for (const issuer of formD.issuerList?.issuer || []) {
    await processIssuer(cik, issuer, false);
  }
  for (const person of formD.relatedPersonsList?.relatedPersonInfo || []) {
    await processRelatedPerson(cik, RELATION_TYPE_RELATED_PERSON, person);
  }

  if (formD.offeringData?.signatureBlock) {
    await processSignatureBlock(cik, formD.offeringData.signatureBlock);
  }
}
