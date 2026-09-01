/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildObserveOnlyEntityObserver } from "../../../resolver/buildObserveOnlyEntityObserver";
import type { ObserveOnlyEntityObserver } from "../../../resolver/EntityObserver";
import type { AddressImport } from "../../../storage/address/AddressNormalization";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { hasCompanyEnding } from "../../../storage/company/CompanyNormalization";
import { Section16Repo } from "../../../storage/section16/Section16Repo";
import type {
  Section16Holding,
  Section16Transaction,
} from "../../../storage/section16/Section16Schema";
import { isBadPersonField } from "../../../types/edgar/bad-data";
import { parseCikSafely } from "../../../util/parseCik";
import type { OwnershipDocument } from "./OwnershipDocument.schema";
import { numWrapped as num, strWrapped as str } from "../_valueHelpers";

// EDGAR ownership flags appear as "1"/"0" (X0609) or "true"/"false" (X0607).
function toBool(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true";
}

interface OwnershipStorageContext {
  readonly accession_number: string;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly filing_date: string;
  // Null when the XML `issuer.issuerCik` is missing or unparseable. Must NOT
  // be coerced to 0 on the observation path: PersonResolver's `personKey`
  // includes `source_filing_issuer_cik` in the name-fallback key, so a 0
  // sentinel collapses reporting-owner observations with the same name
  // across unrelated filers into one canonical person. Form_144 already
  // guards this at `Form_144.storage.ts` with `issuer_cik || null`.
  readonly issuer_cik: number | null;
  readonly observer: ObserveOnlyEntityObserver;
}

/**
 * Builds a human-readable relationship label and officer title from the
 * reportingOwnerRelationship flags.
 */
function describeRelationship(
  rel: NonNullable<OwnershipDocument["reportingOwner"]>[number]["reportingOwnerRelationship"]
): { relationship: string; title: string | null } {
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
      const saved = await addressRepo.saveAddressIfUsable(addrImport);
      if (saved) address_id = saved.address_hash_id;
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
        titles: title == null ? null : [title],
        relationship,
        filing_date: ctx.filing_date,
        role_scope: "section16:reporting-owner",
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
    cik: ctx.issuer_cik,
    name: issuerName,
    source_context: JSON.stringify({ relation: "section16:issuer" }),
  });
}

export async function processOwnershipForm({
  accession_number,
  filing_date,
  form,
  extractor_id,
  doc,
}: {
  cik: number;
  file_number: string;
  accession_number: string;
  filing_date: string;
  primary_doc: string;
  form: string;
  /**
   * The extractor running this store, carried from the registry entry that
   * dispatched it. Forms 3, 4 and 5 register three separate extractors over
   * this one handler precisely so each keeps its own version slot, so the id
   * has to arrive with the dispatch: re-deriving it from the form symbol
   * cannot answer which extractor is running, and observation rows and
   * `extractor_runs` would disagree the moment one form carries two.
   */
  extractor_id: string;
  doc: OwnershipDocument;
}): Promise<void> {
  // 1.0.1 (S-MAIN-01): preserve null issuer_cik on observation path so
  // PersonResolver does not collapse same-named reporting owners across
  // unrelated filers via the 0 sentinel. Patch bump — same dev cycle.
  const extractor_version = "1.0.1";

  // The XML issuerCik is authoritative. We must NOT fall back to the filing's
  // own CIK: ownership filings are ingested from a submission feed that may be
  // the reporting owner's, not the issuer's, so that fallback could stamp the
  // owner's CIK as the issuer. Use `|| null` (not `parseCikSafely` alone): the
  // raw 0 sentinel poisons PersonResolver's name-fallback key — see Form_144
  // for the parallel guard. Section16 row sites coerce back with `?? 0` since
  // the SQL column is non-null (TypeSecCik is `Type.Number`).
  const issuer_cik = parseCikSafely(doc.issuer?.issuerCik) || null;

  const observer = buildObserveOnlyEntityObserver();

  const ctx: OwnershipStorageContext = {
    accession_number,
    extractor_id,
    extractor_version,
    filing_date,
    issuer_cik,
    observer,
  };

  const section16Repo = new Section16Repo();

  // Section16 SQL columns require a non-null CIK (TypeSecCik is `Type.Number`).
  // 0 is acceptable here as a "missing" sentinel for the raw section16 row;
  // it is NOT acceptable on the observation/resolver path above.
  const section16IssuerCik = issuer_cik ?? 0;

  await section16Repo.saveFiling({
    accession_number,
    form,
    document_type: str(doc.documentType) ?? form,
    issuer_cik: section16IssuerCik,
    issuer_name: str(doc.issuer?.issuerName) ?? "",
    issuer_trading_symbol: str(doc.issuer?.issuerTradingSymbol),
    period_of_report: str(doc.periodOfReport),
    filing_date: filing_date || null,
    not_subject_to_section16: toBool(doc.notSubjectToSection16),
    no_securities_owned: toBool(doc.noSecuritiesOwned),
    remarks: str(doc.remarks),
  });

  await processIssuer(doc, ctx);
  await processReportingOwners(doc, ctx);

  // Re-extraction reuses the same positional indices, so clear any prior rows
  // first to avoid leaving stale orphans when a filing now yields fewer.
  await section16Repo.clearTransactions(accession_number);
  await section16Repo.clearHoldings(accession_number);

  // Transactions: non-derivative first, then derivative, in a single index space.
  let txnIndex = 0;
  for (const t of doc.nonDerivativeTable?.nonDerivativeTransaction ?? []) {
    await section16Repo.saveTransaction(
      nonDerivativeTransactionRow(t, accession_number, section16IssuerCik, txnIndex++)
    );
  }
  for (const t of doc.derivativeTable?.derivativeTransaction ?? []) {
    await section16Repo.saveTransaction(
      derivativeTransactionRow(t, accession_number, section16IssuerCik, txnIndex++)
    );
  }

  // Holdings: non-derivative first, then derivative.
  let holdIndex = 0;
  for (const h of doc.nonDerivativeTable?.nonDerivativeHolding ?? []) {
    await section16Repo.saveHolding(
      nonDerivativeHoldingRow(h, accession_number, section16IssuerCik, holdIndex++)
    );
  }
  for (const h of doc.derivativeTable?.derivativeHolding ?? []) {
    await section16Repo.saveHolding(
      derivativeHoldingRow(h, accession_number, section16IssuerCik, holdIndex++)
    );
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
