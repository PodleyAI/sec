/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { hasCompanyEnding } from "../../../storage/company/CompanyNormalization";
import { CrowdfundingRepo } from "../../../storage/portal/CrowdfundingRepo";
import { CrowdfundingTemporalRepo } from "../../../storage/portal/CrowdfundingTemporalRepo";
import type {
  Crowdfunding,
  CrowdfundingOfferings,
  CrowdfundingReports,
} from "../../../storage/portal/CrowdfundingSchema";
import { isBadPersonField } from "../../../types/edgar/bad-data";
import type { FormC } from "./Form_C.schema";
import { parseCikSafely } from "../../../util/parseCik";
import { numScalar, strScalar } from "../_valueHelpers";
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

interface FormCStorageContext {
  readonly accession_number: string;
  readonly extractor_id: "C";
  readonly extractor_version: string;
  readonly observer: EntityObserver;
}

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
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*%/);
  if (match) {
    const pct = parseFloat(match[1]) / 100;
    const rest = trimmed.slice(match[0].length).trim();
    return { percent: pct, detail: rest || null };
  }
  return { percent: null, detail: trimmed || null };
}

/**
 * Maps a Form C submission type to the offering's stored lifecycle status.
 *
 * The post-offering withdrawal codes (C-U-W, C-AR-W, C-AR/A-W, C-TR-W)
 * withdraw the *referenced filing*, not the offering itself — a C-TR-W
 * rescinds a termination, so storing "termination" (or a blanket
 * "withdrawn") would misstate the offering. They get dedicated
 * `<base>-withdrawn` statuses instead. Only C-W withdraws the offering;
 * C/A-W keeps its historical "amended" mapping because EDGAR sometimes
 * re-tags an in-flight C/A as C/A-W (see Form_variants.test.ts).
 */
export function determineStatus(submissionType: string): string {
  switch (submissionType) {
    case "C":
      return "active";
    case "C/A":
    case "C/A-W":
      return "amended";
    case "C-W":
      return "withdrawn";
    case "C-U":
      return "progress-update";
    case "C-U-W":
      return "progress-update-withdrawn";
    case "C-AR":
    case "C-AR/A":
      return "annual-report";
    case "C-AR-W":
    case "C-AR/A-W":
      return "annual-report-withdrawn";
    case "C-TR":
      return "termination";
    case "C-TR-W":
      return "termination-withdrawn";
    default:
      return "active";
  }
}

async function processIssuer(
  cik: number,
  formC: FormC,
  ctx: FormCStorageContext,
  index: number
): Promise<void> {
  const addressRepo = new AddressRepo();
  const issuerInfo = formC.formData.issuerInformation.issuerInfo;

  let addr: Awaited<ReturnType<typeof addressRepo.saveAddress>> | null = null;
  if (issuerInfo.issuerAddress) {
    try {
      addr = await addressRepo.saveAddress(issuerInfo.issuerAddress);
    } catch (error) {
      console.warn(`Failed to save address for Form C issuer ${issuerInfo.nameOfIssuer}:`, error);
    }
  }

  await ctx.observer.observeCompany({
    accession_number: ctx.accession_number,
    extractor_id: ctx.extractor_id,
    extractor_version: ctx.extractor_version,
    observation_index: index,
    cik,
    name: issuerInfo.nameOfIssuer,
    address_id: addr?.address_hash_id ?? null,
    source_context: JSON.stringify({ relation: "form-c:issuer" }),
  });
}

async function processCoIssuers(
  cik: number,
  formC: FormC,
  ctx: FormCStorageContext,
  startIndex: number
): Promise<void> {
  const coIssuers = formC.formData.issuerInformation.coIssuers?.coIssuerInfo;
  if (!coIssuers) return;

  const addressRepo = new AddressRepo();

  for (let i = 0; i < coIssuers.length; i++) {
    const coIssuer = coIssuers[i];
    if (!coIssuer.nameOfCoIssuer) continue;

    let addr: Awaited<ReturnType<typeof addressRepo.saveAddress>> | null = null;
    if (coIssuer.coIssuerAddress) {
      try {
        addr = await addressRepo.saveAddress(coIssuer.coIssuerAddress);
      } catch (error) {
        console.warn(
          `Failed to save address for Form C co-issuer ${coIssuer.nameOfCoIssuer}:`,
          error
        );
      }
    }

    await ctx.observer.observeCompany({
      accession_number: ctx.accession_number,
      extractor_id: ctx.extractor_id,
      extractor_version: ctx.extractor_version,
      observation_index: startIndex + i,
      cik: null,
      name: coIssuer.nameOfCoIssuer,
      address_id: addr?.address_hash_id ?? null,
      source_context: JSON.stringify({ relation: "form-c:co-issuer" }),
    });
  }
}

async function processSignatures(
  cik: number,
  formC: FormC,
  ctx: FormCStorageContext,
  startIndex: number
): Promise<void> {
  const signatureInfo = formC.formData.signatureInfo;

  // Issuer signature at startIndex (100)
  const issuerSig = signatureInfo.issuerSignature;
  if (issuerSig.issuerSignature && !isBadPersonField(issuerSig.issuerSignature)) {
    const sigName = issuerSig.issuerSignature;
    const titles = [issuerSig.issuerTitle || "Signer"];

    if (hasCompanyEnding(sigName)) {
      await ctx.observer.observeCompany({
        accession_number: ctx.accession_number,
        extractor_id: ctx.extractor_id,
        extractor_version: ctx.extractor_version,
        observation_index: startIndex,
        cik: null,
        name: sigName,
        source_context: JSON.stringify({ relation: "form-c:signature", titles }),
      });
    } else {
      await ctx.observer.observePerson({
        accession_number: ctx.accession_number,
        extractor_id: ctx.extractor_id,
        extractor_version: ctx.extractor_version,
        observation_index: startIndex,
        source_filing_issuer_cik: cik,
        last_name: sigName,
        title: titles[0] ?? null,
        relationship: "form-c:signature",
        source_context: JSON.stringify({ relation: "form-c:signature", titles }),
      });
    }
  }

  // Signature persons at startIndex + 1, startIndex + 2, ...
  if (signatureInfo.signaturePersons?.signaturePerson) {
    let idx = startIndex + 1;
    for (const sp of signatureInfo.signaturePersons.signaturePerson) {
      if (isBadPersonField(sp.personSignature)) continue;

      const sigName = sp.personSignature;
      const titles = [sp.personTitle || "Signer"];

      if (hasCompanyEnding(sigName)) {
        await ctx.observer.observeCompany({
          accession_number: ctx.accession_number,
          extractor_id: ctx.extractor_id,
          extractor_version: ctx.extractor_version,
          observation_index: idx,
          cik: null,
          name: sigName,
          source_context: JSON.stringify({ relation: "form-c:signature", titles }),
        });
      } else {
        await ctx.observer.observePerson({
          accession_number: ctx.accession_number,
          extractor_id: ctx.extractor_id,
          extractor_version: ctx.extractor_version,
          observation_index: idx,
          source_filing_issuer_cik: cik,
          last_name: sigName,
          title: titles[0] ?? null,
          relationship: "form-c:signature",
          source_context: JSON.stringify({ relation: "form-c:signature", titles }),
        });
      }
      idx++;
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
    price: numScalar(offeringInfo.price),
    price_determination_method: offeringInfo.priceDeterminationMethod ?? null,
    offering_amount: numScalar(offeringInfo.offeringAmount),
    maximum_offering_amount: numScalar(offeringInfo.maximumOfferingAmount),
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

  // numScalar drops empty / whitespace strings so we don't persist a
  // fabricated 0 disclosure_value (used to surface in reports as if the
  // issuer reported $0).
  //
  // `currentEmployees` is the only field schema-typed as
  // DECIMAL_TYPE7_2_NONNEGATIVE; before the string-decimal migration,
  // TypeBox enforced `minimum: 0` at parse time. Now that the leaf is a
  // string routed through numScalar(), we enforce the non-negative
  // invariant here so a malformed feed (e.g. -1) can't reach disclosure
  // storage as a negative count.
  const rawCurrentEmployees = numScalar(disclosures.currentEmployees);
  const currentEmployees =
    rawCurrentEmployees !== null && rawCurrentEmployees >= 0 ? rawCurrentEmployees : null;
  const fields: Array<[string, number | null]> = [
    ["currentEmployees", currentEmployees],
    ["totalAssetMostRecentFiscalYear", numScalar(disclosures.totalAssetMostRecentFiscalYear)],
    ["totalAssetPriorFiscalYear", numScalar(disclosures.totalAssetPriorFiscalYear)],
    ["cashEquiMostRecentFiscalYear", numScalar(disclosures.cashEquiMostRecentFiscalYear)],
    ["cashEquiPriorFiscalYear", numScalar(disclosures.cashEquiPriorFiscalYear)],
    ["actReceivedMostRecentFiscalYear", numScalar(disclosures.actReceivedMostRecentFiscalYear)],
    ["actReceivedPriorFiscalYear", numScalar(disclosures.actReceivedPriorFiscalYear)],
    ["shortTermDebtMostRecentFiscalYear", numScalar(disclosures.shortTermDebtMostRecentFiscalYear)],
    ["shortTermDebtPriorFiscalYear", numScalar(disclosures.shortTermDebtPriorFiscalYear)],
    ["longTermDebtMostRecentFiscalYear", numScalar(disclosures.longTermDebtMostRecentFiscalYear)],
    ["longTermDebtPriorFiscalYear", numScalar(disclosures.longTermDebtPriorFiscalYear)],
    ["revenueMostRecentFiscalYear", numScalar(disclosures.revenueMostRecentFiscalYear)],
    ["revenuePriorFiscalYear", numScalar(disclosures.revenuePriorFiscalYear)],
    ["costGoodsSoldMostRecentFiscalYear", numScalar(disclosures.costGoodsSoldMostRecentFiscalYear)],
    ["costGoodsSoldPriorFiscalYear", numScalar(disclosures.costGoodsSoldPriorFiscalYear)],
    ["taxPaidMostRecentFiscalYear", numScalar(disclosures.taxPaidMostRecentFiscalYear)],
    ["taxPaidPriorFiscalYear", numScalar(disclosures.taxPaidPriorFiscalYear)],
    ["netIncomeMostRecentFiscalYear", numScalar(disclosures.netIncomeMostRecentFiscalYear)],
    ["netIncomePriorFiscalYear", numScalar(disclosures.netIncomePriorFiscalYear)],
  ];

  for (const [name, value] of fields) {
    if (value === null) continue;
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

  const ctx: FormCStorageContext = {
    accession_number,
    extractor_id: "C",
    extractor_version,
    observer,
  };

  const temporalRepo = new CrowdfundingTemporalRepo();

  const issuerInfo = formC.formData.issuerInformation;
  const issuer = issuerInfo.issuerInfo;
  const submissionType = formC.headerData.submissionType;

  const parsedPortalCik = parseCikSafely(issuerInfo.commissionCik);

  // The mutable row reflects the latest filing by *filing date*, not by
  // processing order: a back-catalog replay of an older filing must not regress
  // it. The read-merge-write is atomic per (cik, file_number) and treats an
  // undated incoming filing ("") as stale, so a filer header with no SGML date
  // does not clobber a known-dated mutable row. Post-offering filings (C-AR /
  // C-TR) carry no <commissionCik> and often no legal-status block, so the
  // builder merges those fields forward from the existing row instead of
  // clobbering them with empties. The history snapshot is always written (a
  // stale replay still belongs in the time series); only the mutable-row write
  // is suppressed via skipMutableUpdate. The filing_date is exempt from the
  // merge fallback: a stale replay records its own filing_date so the series
  // reflects when each filing was actually made. The per-filing tables
  // (offerings, disclosure reports, observations) below are keyed by
  // filing/accession and always record the older filing too.
  await temporalRepo.saveCurrentByFilingDate(
    cik,
    file_number,
    filing_date,
    `Form ${submissionType}`,
    accession_number,
    (existing, isStale) => ({
      cik,
      file_number,
      filing_date: isStale ? filing_date : filing_date || existing?.filing_date || "",
      name: strScalar(issuer.nameOfIssuer) || existing?.name || "",
      legal_status: issuer.legalStatus?.legalStatusForm ?? existing?.legal_status ?? "",
      state_jurisdiction:
        issuer.legalStatus?.jurisdictionOrganization ?? existing?.state_jurisdiction ?? "",
      date_incorporation:
        issuer.legalStatus?.dateIncorporation ?? existing?.date_incorporation ?? "",
      url: issuer.issuerWebsite ?? existing?.url ?? "",
      portal_cik: parsedPortalCik > 0 ? parsedPortalCik : (existing?.portal_cik ?? 0),
      status: determineStatus(submissionType),
      progress_update: issuerInfo.progressUpdate ?? existing?.progress_update ?? null,
      nature_of_amendment: issuerInfo.natureOfAmendment ?? existing?.nature_of_amendment ?? null,
    })
  );

  // Issuers: index 0 (issuer), 1+ (co-issuers)
  await processIssuer(cik, formC, ctx, 0);
  await processCoIssuers(cik, formC, ctx, 1);

  await processOfferingInfo(cik, file_number, filing_date, formC);
  await processAnnualReportDisclosures(cik, file_number, filing_date, formC);

  // Signatures: index 100 (issuer signature), 101+ (signature persons)
  await processSignatures(cik, formC, ctx, 100);
}
