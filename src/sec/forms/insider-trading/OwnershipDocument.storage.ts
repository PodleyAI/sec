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
import { Section16Repo } from "../../../storage/section16/Section16Repo";
import type {
  Section16Holding,
  Section16Transaction,
} from "../../../storage/section16/Section16Schema";
import type { OwnershipDocument } from "./OwnershipDocument.schema";

// EDGAR ownership flags appear as "1"/"0" (X0609) or "true"/"false" (X0607).
function toBool(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true";
}

// Unwrap a `{ value }` leaf to its string, treating empty as null.
function str(field: { value?: string } | string | undefined): string | null {
  if (field === undefined || field === null) return null;
  if (typeof field === "string") return field.trim() || null;
  const v = field.value;
  return v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim();
}

// Unwrap a `{ value }` leaf to a finite number, or null.
function num(field: { value?: number | string } | string | undefined): number | null {
  if (field === undefined || field === null || typeof field === "string") return null;
  const v = field.value;
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

interface OwnershipStorageContext {
  readonly accession_number: string;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly issuer_cik: number;
  readonly observer: EntityObserver;
}

/**
 * Builds a human-readable relationship label and officer title from the
 * reportingOwnerRelationship flags.
 */
function describeRelationship(rel: NonNullable<
  OwnershipDocument["reportingOwner"]
>[number]["reportingOwnerRelationship"]): { relationship: string; title: string | null } {
  if (!rel) return { relationship: "reporting-owner", title: null };
  const roles: string[] = [];
  if (toBool(rel.isDirector)) roles.push("director");
  if (toBool(rel.isOfficer)) roles.push("officer");
  if (toBool(rel.isTenPercentOwner)) roles.push("10% owner");
  if (toBool(rel.isOther)) roles.push(str(rel.otherText) ?? "other");
  const title = toBool(rel.isOfficer) ? str(rel.officerTitle) : null;
  return {
    relationship: roles.length ? roles.join(", ") : "reporting-owner",
    title,
  };
}

// EDGAR ownership filings carry no explicit person/entity flag. Directors and
// officers are always individuals, so those flags decide outright. Otherwise we
// fall back to a company-ending test on a cleaned name — stripping trailing
// punctuation and a lone trailing initial ("SMITH JOHN A") that would otherwise
// trip the ending regex.
function ownerIsCompany(
  name: string,
  rel: NonNullable<OwnershipDocument["reportingOwner"]>[number]["reportingOwnerRelationship"]
): boolean {
  if (rel && (toBool(rel.isDirector) || toBool(rel.isOfficer))) return false;
  const cleaned = name
    .trim()
    .replace(/[.,]+$/, "")
    .replace(/\s+[A-Z]$/, "")
    .trim();
  return hasCompanyEnding(cleaned);
}

function buildOwnerAddress(
  addr: NonNullable<OwnershipDocument["reportingOwner"]>[number]["reportingOwnerAddress"]
): AddressImport | null {
  if (!addr) return null;
  const street1 = str(addr.rptOwnerStreet1);
  const city = str(addr.rptOwnerCity);
  const stateOrCountry = str(addr.rptOwnerState) ?? str(addr.rptOwnerNonUSStateTerritory);
  if (!street1 && !city) return null;
  return {
    street1,
    street2: str(addr.rptOwnerStreet2),
    city,
    stateOrCountry,
    countryCode: str(addr.rptOwnerCountry),
    stateOrCountryDescription: str(addr.rptOwnerStateDescription),
    zipCode: str(addr.rptOwnerZipCode),
    isForeignLocation: toBool(addr.rptOwnerNonUSAddressFlag),
  };
}

async function processReportingOwners(
  doc: OwnershipDocument,
  ctx: OwnershipStorageContext
): Promise<void> {
  const owners = doc.reportingOwner ?? [];
  const addressRepo = new AddressRepo();

  for (let i = 0; i < owners.length; i++) {
    const owner = owners[i];
    const name = str(owner.reportingOwnerId?.rptOwnerName);
    if (!name) continue;

    const cik = parseCikSafely(owner.reportingOwnerId?.rptOwnerCik) || null;
    const { relationship, title } = describeRelationship(owner.reportingOwnerRelationship);

    let address_id: string | null = null;
    const addrImport = buildOwnerAddress(owner.reportingOwnerAddress);
    if (addrImport) {
      try {
        const saved = await addressRepo.saveAddress(addrImport);
        address_id = saved.address_hash_id;
      } catch (error) {
        console.warn(`Failed to save address for reporting owner ${name}:`, error);
      }
    }

    const observation_index = i + 1; // 0 reserved for the issuer
    const source_context = JSON.stringify({ relation: "section16:reporting-owner", relationship });

    if (ownerIsCompany(name, owner.reportingOwnerRelationship)) {
      await ctx.observer.observeCompany({
        accession_number: ctx.accession_number,
        extractor_id: ctx.extractor_id,
        extractor_version: ctx.extractor_version,
        observation_index,
        cik,
        name,
        address_id,
        source_context,
      });
    } else if (!isBadPersonField(name)) {
      await ctx.observer.observePerson({
        accession_number: ctx.accession_number,
        extractor_id: ctx.extractor_id,
        extractor_version: ctx.extractor_version,
        observation_index,
        source_filing_issuer_cik: ctx.issuer_cik,
        cik,
        last_name: name,
        title,
        relationship,
        address_id,
        source_context,
      });
    }
  }
}

async function processIssuer(doc: OwnershipDocument, ctx: OwnershipStorageContext): Promise<void> {
  const issuerName = str(doc.issuer?.issuerName);
  if (!issuerName) return;
  await ctx.observer.observeCompany({
    accession_number: ctx.accession_number,
    extractor_id: ctx.extractor_id,
    extractor_version: ctx.extractor_version,
    observation_index: 0,
    cik: ctx.issuer_cik || null,
    name: issuerName,
    source_context: JSON.stringify({ relation: "section16:issuer" }),
  });
}

export async function processOwnershipForm({
  cik,
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
  doc: OwnershipDocument;
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

  // The canonical extractor id is the bare document type (3/4/5); amendments
  // share the same extractor.
  const extractor_id = (str(doc.documentType) ?? form).replace("/A", "");
  const issuer_cik = parseCikSafely(doc.issuer?.issuerCik) || cik;

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

  const observer = new EntityObserver({
    personObservationRepo: new PersonObservationRepo(),
    companyObservationRepo: new CompanyObservationRepo(),
    personIdentityLinkRepo: new PersonIdentityLinkRepo(),
    companyIdentityLinkRepo: new CompanyIdentityLinkRepo(),
    personResolver,
    companyResolver,
    canonicalPersonAddressRepo: new CanonicalPersonAddressRepo(),
    canonicalPersonPhoneRepo: new CanonicalPersonPhoneRepo(),
    canonicalCompanyAddressRepo: new CanonicalCompanyAddressRepo(),
    canonicalCompanyPhoneRepo: new CanonicalCompanyPhoneRepo(),
    activeResolverPersonVersion,
    activeResolverCompanyVersion,
  });

  const ctx: OwnershipStorageContext = {
    accession_number,
    extractor_id,
    extractor_version,
    issuer_cik,
    observer,
  };

  const section16Repo = new Section16Repo();

  await section16Repo.saveFiling({
    accession_number,
    form,
    document_type: str(doc.documentType) ?? form,
    issuer_cik,
    issuer_name: str(doc.issuer?.issuerName) ?? "",
    issuer_trading_symbol: str(doc.issuer?.issuerTradingSymbol),
    period_of_report: str(doc.periodOfReport) ?? (filing_date || null),
    filing_date: filing_date || null,
    not_subject_to_section16: toBool(doc.notSubjectToSection16),
    no_securities_owned: toBool(doc.noSecuritiesOwned),
    remarks: str(doc.remarks),
  });

  await processIssuer(doc, ctx);
  await processReportingOwners(doc, ctx);

  // Transactions: non-derivative first, then derivative, in a single index space.
  let txnIndex = 0;
  for (const t of doc.nonDerivativeTable?.nonDerivativeTransaction ?? []) {
    await section16Repo.saveTransaction(nonDerivativeTransactionRow(t, accession_number, issuer_cik, txnIndex++));
  }
  for (const t of doc.derivativeTable?.derivativeTransaction ?? []) {
    await section16Repo.saveTransaction(derivativeTransactionRow(t, accession_number, issuer_cik, txnIndex++));
  }

  // Holdings: non-derivative first, then derivative.
  let holdIndex = 0;
  for (const h of doc.nonDerivativeTable?.nonDerivativeHolding ?? []) {
    await section16Repo.saveHolding(nonDerivativeHoldingRow(h, accession_number, issuer_cik, holdIndex++));
  }
  for (const h of doc.derivativeTable?.derivativeHolding ?? []) {
    await section16Repo.saveHolding(derivativeHoldingRow(h, accession_number, issuer_cik, holdIndex++));
  }
}

type NonDerivTxn = NonNullable<
  NonNullable<OwnershipDocument["nonDerivativeTable"]>["nonDerivativeTransaction"]
>[number];
type DerivTxn = NonNullable<
  NonNullable<OwnershipDocument["derivativeTable"]>["derivativeTransaction"]
>[number];
type NonDerivHold = NonNullable<
  NonNullable<OwnershipDocument["nonDerivativeTable"]>["nonDerivativeHolding"]
>[number];
type DerivHold = NonNullable<
  NonNullable<OwnershipDocument["derivativeTable"]>["derivativeHolding"]
>[number];

function nonDerivativeTransactionRow(
  t: NonDerivTxn,
  accession_number: string,
  issuer_cik: number,
  transaction_index: number
): Section16Transaction {
  const code = t.transactionCoding;
  const amt = t.transactionAmounts;
  const post = t.postTransactionAmounts;
  const own = t.ownershipNature;
  return {
    accession_number,
    transaction_index,
    issuer_cik,
    is_derivative: false,
    security_title: str(t.securityTitle),
    transaction_date: str(t.transactionDate),
    deemed_execution_date: str(t.deemedExecutionDate),
    transaction_code: code ? str(code.transactionCode) : null,
    transaction_form_type: code ? str(code.transactionFormType) : null,
    equity_swap_involved: code?.equitySwapInvolved ? toBool(code.equitySwapInvolved) : null,
    acquired_disposed_code: amt ? str(amt.transactionAcquiredDisposedCode) : null,
    shares: amt ? num(amt.transactionShares) : null,
    price_per_share: amt ? num(amt.transactionPricePerShare) : null,
    shares_owned_following: post ? num(post.sharesOwnedFollowingTransaction) : null,
    value_owned_following: post ? num(post.valueOwnedFollowingTransaction) : null,
    direct_or_indirect_ownership: own ? str(own.directOrIndirectOwnership) : null,
    nature_of_ownership: own ? str(own.natureOfOwnership) : null,
    conversion_or_exercise_price: null,
    exercise_date: null,
    expiration_date: null,
    underlying_security_title: null,
    underlying_security_shares: null,
    underlying_security_value: null,
  };
}

function derivativeTransactionRow(
  t: DerivTxn,
  accession_number: string,
  issuer_cik: number,
  transaction_index: number
): Section16Transaction {
  const code = t.transactionCoding;
  const amt = t.transactionAmounts;
  const post = t.postTransactionAmounts;
  const own = t.ownershipNature;
  const under = t.underlyingSecurity;
  return {
    accession_number,
    transaction_index,
    issuer_cik,
    is_derivative: true,
    security_title: str(t.securityTitle),
    transaction_date: str(t.transactionDate),
    deemed_execution_date: str(t.deemedExecutionDate),
    transaction_code: code ? str(code.transactionCode) : null,
    transaction_form_type: code ? str(code.transactionFormType) : null,
    equity_swap_involved: code?.equitySwapInvolved ? toBool(code.equitySwapInvolved) : null,
    acquired_disposed_code: amt ? str(amt.transactionAcquiredDisposedCode) : null,
    shares: amt ? num(amt.transactionShares) : null,
    price_per_share: amt ? num(amt.transactionPricePerShare) : null,
    shares_owned_following: post ? num(post.sharesOwnedFollowingTransaction) : null,
    value_owned_following: post ? num(post.valueOwnedFollowingTransaction) : null,
    direct_or_indirect_ownership: own ? str(own.directOrIndirectOwnership) : null,
    nature_of_ownership: own ? str(own.natureOfOwnership) : null,
    conversion_or_exercise_price: num(t.conversionOrExercisePrice),
    exercise_date: str(t.exerciseDate),
    expiration_date: str(t.expirationDate),
    underlying_security_title: under ? str(under.underlyingSecurityTitle) : null,
    underlying_security_shares: under ? num(under.underlyingSecurityShares) : null,
    underlying_security_value: under ? num(under.underlyingSecurityValue) : null,
  };
}

function nonDerivativeHoldingRow(
  h: NonDerivHold,
  accession_number: string,
  issuer_cik: number,
  holding_index: number
): Section16Holding {
  const post = h.postTransactionAmounts;
  const own = h.ownershipNature;
  return {
    accession_number,
    holding_index,
    issuer_cik,
    is_derivative: false,
    security_title: str(h.securityTitle),
    shares_owned_following: post ? num(post.sharesOwnedFollowingTransaction) : null,
    value_owned_following: post ? num(post.valueOwnedFollowingTransaction) : null,
    direct_or_indirect_ownership: own ? str(own.directOrIndirectOwnership) : null,
    nature_of_ownership: own ? str(own.natureOfOwnership) : null,
    conversion_or_exercise_price: null,
    exercise_date: null,
    expiration_date: null,
    underlying_security_title: null,
    underlying_security_shares: null,
    underlying_security_value: null,
  };
}

function derivativeHoldingRow(
  h: DerivHold,
  accession_number: string,
  issuer_cik: number,
  holding_index: number
): Section16Holding {
  const post = h.postTransactionAmounts;
  const own = h.ownershipNature;
  const under = h.underlyingSecurity;
  return {
    accession_number,
    holding_index,
    issuer_cik,
    is_derivative: true,
    security_title: str(h.securityTitle),
    shares_owned_following: post ? num(post.sharesOwnedFollowingTransaction) : null,
    value_owned_following: post ? num(post.valueOwnedFollowingTransaction) : null,
    direct_or_indirect_ownership: own ? str(own.directOrIndirectOwnership) : null,
    nature_of_ownership: own ? str(own.natureOfOwnership) : null,
    conversion_or_exercise_price: num(h.conversionOrExercisePrice),
    exercise_date: str(h.exerciseDate),
    expiration_date: str(h.expirationDate),
    underlying_security_title: under ? str(under.underlyingSecurityTitle) : null,
    underlying_security_shares: under ? num(under.underlyingSecurityShares) : null,
    underlying_security_value: under ? num(under.underlyingSecurityValue) : null,
  };
}
