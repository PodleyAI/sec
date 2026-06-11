/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { hasCompanyEnding } from "../../../storage/company/CompanyNormalization";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import type { RegAOffering } from "../../../storage/reg-a/RegAOfferingSchema";
import type { RegAOfferingHistory } from "../../../storage/reg-a/RegAOfferingHistorySchema";
import type { RegAFinancialData } from "../../../storage/reg-a/RegAFinancialDataSchema";
import { extractServiceProviders } from "./RegA_shared";
import type { Form1Z } from "./Form_1_Z.schema";
import { numScalar } from "../_valueHelpers";
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

interface Form1ZStorageContext {
  readonly accession_number: string;
  readonly extractor_id: "1-Z";
  readonly extractor_version: string;
  readonly observer: EntityObserver;
}

async function processIssuer(
  cik: number,
  form1Z: Form1Z,
  ctx: Form1ZStorageContext,
  startIndex: number
): Promise<void> {
  const addressRepo = new AddressRepo();

  const item1 = form1Z.formData.item1;

  let addr: Awaited<ReturnType<typeof addressRepo.saveAddress>> | null = null;
  try {
    addr = await addressRepo.saveAddress({
      street1: item1.street1,
      street2: item1.street2,
      city: item1.city,
      stateOrCountry: item1.stateOrCountry,
      zipCode: item1.zipCode,
    });
  } catch (error) {
    console.warn(`Failed to save address for Form 1-Z issuer ${item1.issuerName}:`, error);
  }

  await ctx.observer.observeCompany({
    accession_number: ctx.accession_number,
    extractor_id: ctx.extractor_id,
    extractor_version: ctx.extractor_version,
    observation_index: startIndex,
    cik,
    name: item1.issuerName,
    address_id: addr?.address_hash_id ?? null,
    international_number: null,
    source_context: JSON.stringify({ relation: "form-1z:issuer" }),
  });
}

async function processOfferingSummaries(
  cik: number,
  file_number: string,
  accession_number: string,
  filing_date: string,
  form1Z: Form1Z,
  ctx: Form1ZStorageContext,
  startIndex: number
): Promise<void> {
  const regARepo = new RegAOfferingRepo();
  const summaryInfoArr = form1Z.formData.summaryInfoOffering;
  if (!summaryInfoArr) return;

  let providerIdx = 0;
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
      price_per_security: numScalar(summaryInfo.pricePerSecurity),
      aggregate_offering_price: numScalar(summaryInfo.portionSecuritiesSoldIssuer),
      aggregate_offering_price_holders: numScalar(summaryInfo.portionSecuritiesSoldSecurityholders),
      issuer_aggregate_offering: null,
      security_holder_aggregate: null,
      total_aggregate_offering: null,
      securities_offered: null,
      outstanding_securities: null,
      estimated_net_amount: numScalar(summaryInfo.issuerNetProceeds),
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
        await ctx.observer.observeCompany({
          accession_number: ctx.accession_number,
          extractor_id: ctx.extractor_id,
          extractor_version: ctx.extractor_version,
          observation_index: startIndex + providerIdx,
          cik: null,
          name: provider.name,
          address_id: null,
          international_number: null,
          source_context: JSON.stringify({
            relation: "form-1z:service-provider",
            providerType: provider.type,
          }),
        });
        providerIdx++;
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

    const approxRecordHolders = numScalar(cert.approxRecordHolders);
    if (approxRecordHolders !== null) {
      const data: RegAFinancialData = {
        cik,
        file_number,
        accession_number,
        field_name: `suspension_${i}_approxRecordHolders`,
        field_value: approxRecordHolders,
      };
      await regARepo.saveFinancialData(data);
    }
  }
}

async function processSignatures(
  cik: number,
  form1Z: Form1Z,
  ctx: Form1ZStorageContext,
  startIndex: number
): Promise<void> {
  let idx = 0;

  for (const sig of form1Z.formData.signatureTab) {
    let signerName: string | undefined = undefined;
    if (typeof sig.signatureBy === "string") {
      signerName = sig.signatureBy;
    } else if (typeof sig.signatureBy === "object" && sig.signatureBy !== null) {
      const obj = sig.signatureBy as Record<string, unknown>;
      signerName =
        (typeof obj.name === "string" ? obj.name : undefined) ??
        (Object.values(obj).find((v) => typeof v === "string") as string | undefined);
    }
    if (!signerName) continue;

    // Strip common SEC signature prefixes
    signerName = signerName.replace(/^\/s\/\s*/i, "").trim();
    if (!signerName) continue;

    const titles = [sig.title || "Signer"];

    if (hasCompanyEnding(signerName)) {
      await ctx.observer.observeCompany({
        accession_number: ctx.accession_number,
        extractor_id: ctx.extractor_id,
        extractor_version: ctx.extractor_version,
        observation_index: startIndex + idx,
        cik: null,
        name: signerName,
        address_id: null,
        international_number: null,
        source_context: JSON.stringify({ relation: "form-1z:signature", titles }),
      });
    } else {
      try {
        await ctx.observer.observePerson({
          accession_number: ctx.accession_number,
          extractor_id: ctx.extractor_id,
          extractor_version: ctx.extractor_version,
          observation_index: startIndex + idx,
          source_filing_issuer_cik: cik,
          last_name: signerName,
          title: titles[0] ?? null,
          relationship: "form-1z:signature",
          source_context: JSON.stringify({ relation: "form-1z:signature", titles }),
        });
      } catch (error) {
        console.warn(`Failed to normalize signature person ${signerName}:`, error);
      }
    }
    idx++;
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

  const ctx: Form1ZStorageContext = {
    accession_number,
    extractor_id: "1-Z",
    extractor_version,
    observer,
  };

  const regARepo = new RegAOfferingRepo();
  const item1 = form1Z.formData.item1;

  // A 1-Z exit report carries only the issuer name; preserve the descriptive
  // fields the 1-A wrote instead of clobbering them with nulls. The mutable
  // row is latest-by-filing-date: skip stale out-of-order writes (unknown ""
  // dates apply as-is).
  const existing = await regARepo.getOffering(cik, file_number);
  const isStale =
    filing_date !== "" &&
    existing?.as_of != null &&
    existing.as_of !== "" &&
    filing_date < existing.as_of;

  if (!isStale) {
    const offering: RegAOffering = {
      cik,
      file_number,
      issuer_name: item1.issuerName ?? existing?.issuer_name ?? null,
      jurisdiction: existing?.jurisdiction ?? null,
      sic_code: existing?.sic_code ?? null,
      tier: existing?.tier ?? null,
      financial_statement_audit_status: existing?.financial_statement_audit_status ?? null,
      securities_offered_type: existing?.securities_offered_type ?? null,
      industry_group: existing?.industry_group ?? null,
      status: "exit",
      as_of: filing_date || existing?.as_of || null,
    };

    await regARepo.saveOffering(offering);
  }

  await processIssuer(cik, form1Z, ctx, 0);
  await processOfferingSummaries(cik, file_number, accession_number, filing_date, form1Z, ctx, 100);
  await processCertificationSuspension(cik, file_number, accession_number, form1Z);
  await processSignatures(cik, form1Z, ctx, 200);
}
