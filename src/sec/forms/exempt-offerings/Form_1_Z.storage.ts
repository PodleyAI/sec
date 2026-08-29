/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AddressRepo } from "../../../storage/address/AddressRepo";
import { resolveCountryCode } from "../../../storage/address/resolveCountryCode";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import {
  hasCompanyEnding,
  normalizeCompanyName,
} from "../../../storage/company/CompanyNormalization";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import type { RegAOffering } from "../../../storage/reg-a/RegAOfferingSchema";
import type { RegAOfferingHistory } from "../../../storage/reg-a/RegAOfferingHistorySchema";
import type { RegAFinancialData } from "../../../storage/reg-a/RegAFinancialDataSchema";
import { extractServiceProviders } from "./RegA_shared";
import type { Form1Z } from "./Form_1_Z.schema";
import { numScalar } from "../_valueHelpers";
import { buildObserveOnlyEntityObserver } from "../../../resolver/buildObserveOnlyEntityObserver";
import type { ObserveOnlyEntityObserver } from "../../../resolver/EntityObserver";

interface Form1ZStorageContext {
  readonly accession_number: string;
  readonly extractor_id: "1-Z";
  readonly extractor_version: string;
  readonly filing_date: string;
  readonly observer: ObserveOnlyEntityObserver;
}

async function processIssuer(
  cik: number,
  form1Z: Form1Z,
  ctx: Form1ZStorageContext,
  startIndex: number
): Promise<void> {
  const addressRepo = new AddressRepo();
  const phoneRepo = new PhoneRepo();

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

  // The ISSUER's own phone, from the same `item1` block as the address above —
  // not `contact.contactPhone`, which is the EDGAR submission contact and stays
  // unstored, as on Form 1-A and Form D.
  let phone: Awaited<ReturnType<typeof phoneRepo.savePhoneIfUsable>> = undefined;
  if (item1.phone) {
    phone = await phoneRepo.savePhoneIfUsable({
      phone_raw: item1.phone,
      country_code: resolveCountryCode(item1.stateOrCountry),
    });
    if (phone) {
      await phoneRepo.saveRelatedEntity(phone.international_number, "entity:contact", cik);
    }
  }

  await ctx.observer.observeCompany({
    accession_number: ctx.accession_number,
    extractor_id: ctx.extractor_id,
    extractor_version: ctx.extractor_version,
    observation_index: startIndex,
    cik,
    name: item1.issuerName,
    address_id: addr?.address_hash_id ?? null,
    international_number: phone?.international_number ?? null,
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
      // Only Form 1-A states the offering breakdown; the reporting forms do not.
      qualification_offering_aggregate: null,
      concurrent_offering_aggregate: null,
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

      // Guard on the NORMALIZED name, not the raw one. `CompanyResolver` keys on
      // cik -> crd -> normalized_name, so a name that survives this check but
      // normalizes away (a bare legal form like "Inc.", which EDGAR emits when its
      // filer software comma-splits a firm name across repeated elements) resolves
      // to no key at all and THROWS, taking the whole filing down with it.
      // rejoinCommaSplitNames repairs the split upstream; this is the backstop for
      // any other name that cannot identify a company.
      if (provider.name && normalizeCompanyName(provider.name)) {
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
          titles: titles,
          relationship: "form-1z:signature",
          filing_date: ctx.filing_date,
          role_scope: "form-1z:signature",
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
  // 1.1.0: numScalar() treats whitespace-only/empty numeric elements as null
  // instead of fabricating 0 via Value.Convert. Bumped to force re-extract.
  const extractor_version = "1.1.0";

  const observer = buildObserveOnlyEntityObserver();

  const ctx: Form1ZStorageContext = {
    accession_number,
    extractor_id: "1-Z",
    extractor_version,
    filing_date,
    observer,
  };

  const regARepo = new RegAOfferingRepo();
  const item1 = form1Z.formData.item1;

  // A 1-Z exit report carries only the issuer name; preserve the descriptive
  // fields the 1-A wrote instead of clobbering them with nulls. The mutable row
  // is latest-by-filing-date; the read-merge-write is atomic per
  // (cik, file_number) and skips stale out-of-order writes (unknown "" dates
  // apply as-is).
  await regARepo.saveOfferingAsOf(cik, file_number, filing_date, (existing) => ({
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
  }));

  await processIssuer(cik, form1Z, ctx, 0);
  await processOfferingSummaries(cik, file_number, accession_number, filing_date, form1Z, ctx, 100);
  await processCertificationSuspension(cik, file_number, accession_number, form1Z);
  await processSignatures(cik, form1Z, ctx, 200);
}
