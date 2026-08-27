/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import type { AddressImport } from "../../../storage/address/AddressNormalization";
import { hasCompanyEnding } from "../../../storage/company/CompanyNormalization";
import { isBadPersonField } from "../../../types/edgar/bad-data";
import { parseCikSafely } from "../../../util/parseCik";
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
import { formToExtractorId } from "../../../storage/versioning/extractorIds";
import { Form144Repo } from "../../../storage/form144/Form144Repo";
import type { Form144 } from "./Form_144.schema";
import { numScalar as num, strScalar as str } from "../_valueHelpers";

type AddressShape = NonNullable<NonNullable<Form144["formData"]>["issuerInfo"]>["issuerAddress"];

// EDGAR Y/N flags.
function toBoolYN(raw: string | undefined): boolean {
  return str(raw)?.toUpperCase() === "Y";
}

// Every observed Form 144 carries exactly one securitiesInformation/broker
// block, so the schema models them as single objects. Guard anyway: if a
// filing ever repeats the element, fast-xml-parser yields an array, and
// reading a field off it would silently null the whole proposed-sale block —
// fall back to the first block instead.
function firstOf<T>(x: T | readonly T[] | undefined): T | undefined {
  return Array.isArray(x) ? x[0] : (x as T | undefined);
}

function buildAddress(addr: AddressShape): AddressImport | null {
  if (!addr) return null;
  const street1 = str(addr.street1);
  const city = str(addr.city);
  if (!street1 && !city) return null;
  return {
    street1,
    street2: str(addr.street2),
    city,
    stateOrCountry: str(addr.stateOrCountry),
    zipCode: str(addr.zipCode),
  };
}

// The account holder is named in a "person" field but can be a trust/entity.
// Treat as a company only when the name carries a company ending; otherwise a
// person. (Form 144 has no structured person/entity flag.)
function accountHolderIsCompany(name: string): boolean {
  const cleaned = name
    .trim()
    .replace(/[.,]+$/, "")
    .replace(/\s+[A-Z]$/, "")
    .trim();
  return hasCompanyEnding(cleaned);
}

export async function processForm144({
  accession_number,
  filing_date,
  form,
  doc,
}: {
  cik: number;
  file_number: string;
  accession_number: string;
  filing_date: string;
  primary_doc: string;
  form: string;
  doc: Form144;
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
  // 1.1.0: num() now treats whitespace-only numeric elements as null instead
  // of fabricating 0 via Number("   "). Bumped to force production re-extract.
  const extractor_version = "1.1.0";
  const extractor_id = formToExtractorId(form) ?? "144";

  const formData = doc.formData ?? {};
  const issuerInfo = formData.issuerInfo;
  const issuer_cik = parseCikSafely(issuerInfo?.issuerCik);

  const personResolver = new PersonResolver({
    canonicalPersonRepo: new CanonicalPersonRepo(),
    canonicalPersonAliasRepo: new CanonicalPersonAliasRepo(),
    activeResolverVersion: activeResolverPersonVersion,
  });
  const companyResolver = new CompanyResolver({
    canonicalCompanyRepo: new CanonicalCompanyRepo(),
    canonicalCompanyAliasRepo: new CanonicalCompanyAliasRepo(),
    activeResolverVersion: activeResolverCompanyVersion,
  });

  const observer: EntityObserver = new EntityObserver({
    personObservationRepo: new PersonObservationRepo(),
    personObservationTitleRepo: new PersonObservationTitleRepo(),
    companyObservationRepo: new CompanyObservationRepo(),
    personIdentityLinkRepo: new PersonIdentityLinkRepo(),
    companyIdentityLinkRepo: new CompanyIdentityLinkRepo(),
    personResolver,
    companyResolver,
    canonicalPersonAddressRepo: new CanonicalPersonAddressRepo(),
    canonicalPersonPhoneRepo: new CanonicalPersonPhoneRepo(),
    canonicalCompanyAddressRepo: new CanonicalCompanyAddressRepo(),
    canonicalCompanyPhoneRepo: new CanonicalCompanyPhoneRepo(),
    personRoleRepo: new PersonRoleRepo(),
    activeResolverPersonVersion,
    activeResolverCompanyVersion,
  });

  const addressRepo = new AddressRepo();
  const repo = new Form144Repo();

  // firstOf guards the single-element-becomes-array case: if a filing repeats
  // securitiesInformation/broker, fast-xml-parser yields an array and reading a
  // field off it would silently null the whole proposed-sale block.
  const securitiesInfo = firstOf(formData.securitiesInformation);
  const broker = firstOf(securitiesInfo?.brokerOrMarketmakerDetails);
  const relationships = (issuerInfo?.relationshipsToIssuer?.relationshipToIssuer ?? [])
    .map((r) => str(r))
    .filter((r): r is string => r !== null);
  const recentSales = formData.securitiesSoldInPast3Months ?? [];

  // --- Filing header (folds in the single securitiesInformation block) ---
  await repo.saveFiling({
    accession_number,
    form,
    submission_type: str(doc.headerData?.submissionType),
    issuer_cik,
    issuer_name: str(issuerInfo?.issuerName) ?? "",
    sec_file_number: str(issuerInfo?.secFileNumber),
    person_for_whose_account: str(issuerInfo?.nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold),
    relationships_to_issuer: relationships.length ? relationships.join(", ") : null,
    securities_class_title: str(securitiesInfo?.securitiesClassTitle),
    broker_name: str(broker?.name),
    no_of_units_sold: num(securitiesInfo?.noOfUnitsSold),
    aggregate_market_value: num(securitiesInfo?.aggregateMarketValue),
    no_of_units_outstanding: num(securitiesInfo?.noOfUnitsOutstanding),
    approx_sale_date: str(securitiesInfo?.approxSaleDate),
    securities_exchange_name: str(securitiesInfo?.securitiesExchangeName),
    nothing_to_report_past_3_months: toBoolYN(
      formData.nothingToReportFlagOnSecuritiesSoldInPast3Months
    ),
    notice_date: str(formData.noticeSignature?.noticeDate),
    filing_date: filing_date || null,
  });

  // --- Entities: issuer (0), account holder (1), broker (2) ---
  const issuerName = str(issuerInfo?.issuerName);
  if (issuerName) {
    let issuerAddressId: string | null = null;
    const issuerAddr = buildAddress(issuerInfo?.issuerAddress);
    if (issuerAddr) {
      try {
        issuerAddressId = (await addressRepo.saveAddress(issuerAddr)).address_hash_id;
      } catch (error) {
        console.warn(`Failed to save Form 144 issuer address for ${issuerName}:`, error);
      }
    }
    await observer.observeCompany({
      accession_number,
      extractor_id,
      extractor_version,
      observation_index: 0,
      cik: issuer_cik || null,
      name: issuerName,
      address_id: issuerAddressId,
      source_context: JSON.stringify({ relation: "form144:issuer" }),
    });
  }

  const accountName = str(issuerInfo?.nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold);
  if (accountName && !isBadPersonField(accountName)) {
    // Form 144 carries no address for the account holder. The trailing-3-month
    // sellerDetails block has an address, but its seller can be a different
    // party and its name is in the opposite order ("Timothy Go" vs the account
    // holder's "Go Timothy"), so it can't be reliably matched — don't risk
    // attaching the wrong address to the canonical person.
    const relationship = relationships.length ? relationships.join(", ") : "form144:seller";
    if (accountHolderIsCompany(accountName)) {
      await observer.observeCompany({
        accession_number,
        extractor_id,
        extractor_version,
        observation_index: 1,
        cik: null,
        name: accountName,
        source_context: JSON.stringify({ relation: "form144:seller", relationships }),
      });
    } else {
      await observer.observePerson({
        accession_number,
        extractor_id,
        extractor_version,
        observation_index: 1,
        source_filing_issuer_cik: issuer_cik || null,
        last_name: accountName,
        relationship,
        source_context: JSON.stringify({ relation: "form144:seller", relationships }),
      });
    }
  }

  const brokerName = str(broker?.name);
  if (brokerName) {
    let brokerAddressId: string | null = null;
    const brokerAddr = buildAddress(broker?.address);
    if (brokerAddr) {
      try {
        brokerAddressId = (await addressRepo.saveAddress(brokerAddr)).address_hash_id;
      } catch (error) {
        console.warn(`Failed to save Form 144 broker address for ${brokerName}:`, error);
      }
    }
    await observer.observeCompany({
      accession_number,
      extractor_id,
      extractor_version,
      observation_index: 2,
      cik: null,
      name: brokerName,
      address_id: brokerAddressId,
      source_context: JSON.stringify({ relation: "form144:broker" }),
    });
  }

  // --- Detail tables (clear-before-write keeps re-extraction idempotent) ---
  await repo.clearAcquisitions(accession_number);
  await repo.clearRecentSales(accession_number);

  const acquisitions = formData.securitiesToBeSold ?? [];
  for (let i = 0; i < acquisitions.length; i++) {
    const a = acquisitions[i];
    await repo.saveAcquisition({
      accession_number,
      acquisition_index: i,
      issuer_cik,
      securities_class_title: str(a.securitiesClassTitle),
      acquired_date: str(a.acquiredDate),
      nature_of_acquisition: str(a.natureOfAcquisitionTransaction),
      name_of_person_from_whom_acquired: str(a.nameOfPersonfromWhomAcquired),
      is_gift: str(a.isGiftTransaction) !== null ? toBoolYN(a.isGiftTransaction) : null,
      amount_acquired: num(a.amountOfSecuritiesAcquired),
      payment_date: str(a.paymentDate),
      nature_of_payment: str(a.natureOfPayment),
    });
  }

  for (let i = 0; i < recentSales.length; i++) {
    const s = recentSales[i];
    await repo.saveRecentSale({
      accession_number,
      sale_index: i,
      issuer_cik,
      seller_name: str(s.sellerDetails?.name),
      securities_class_title: str(s.securitiesClassTitle),
      sale_date: str(s.saleDate),
      amount_sold: num(s.amountOfSecuritiesSold),
      gross_proceeds: num(s.grossProceeds),
    });
  }
}
