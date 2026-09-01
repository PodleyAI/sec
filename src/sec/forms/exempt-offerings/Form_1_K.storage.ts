/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { numScalar } from "../_valueHelpers";
import { buildObserveOnlyEntityObserver } from "../../../resolver/buildObserveOnlyEntityObserver";
import type { ObserveOnlyEntityObserver } from "../../../resolver/EntityObserver";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { resolveCountryCode } from "../../../storage/address/resolveCountryCode";
import { normalizeCompanyName } from "../../../storage/company/CompanyNormalization";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import type { RegAOfferingHistory } from "../../../storage/reg-a/RegAOfferingHistorySchema";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import type { RegAOffering } from "../../../storage/reg-a/RegAOfferingSchema";
import type { ParsedForm1K } from "./Form_1_K";
import type { Form1K } from "./Form_1_K.schema";
import { extractServiceProviders } from "./RegA_shared";

interface Form1KStorageContext {
  readonly accession_number: string;
  readonly extractor_id: "1-K";
  readonly extractor_version: string;
  readonly observer: ObserveOnlyEntityObserver;
}

async function processIssuer(
  cik: number,
  form1K: Form1K,
  ctx: Form1KStorageContext,
  startIndex: number
): Promise<void> {
  const addressRepo = new AddressRepo();
  const phoneRepo = new PhoneRepo();

  const item1Info = form1K.formData.item1Info;
  const item1 = form1K.formData.item1;

  // Save the shared address from item1 once
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
    console.warn(`Failed to save address for Form 1-K issuer (CIK ${cik}):`, error);
  }

  // The phone from that same `item1` block. It is the ISSUER's own number —
  // not `contact.contactPhone`, which is the EDGAR submission contact (a
  // filing agent or attorney) and deliberately unstored, the same split
  // Form 1-A and Form D already make.
  //
  // `savePhoneIfUsable`, not `savePhone`: EDGAR's phone field is free text and
  // an unparseable value is one contact detail, which must not cost the filing
  // its issuer observations.
  let phone: Awaited<ReturnType<typeof phoneRepo.savePhoneIfUsable>> = undefined;
  if (item1.phoneNumber) {
    phone = await phoneRepo.savePhoneIfUsable({
      phone_raw: item1.phoneNumber,
      country_code: resolveCountryCode(item1.stateOrCountry),
    });
    if (phone) {
      await phoneRepo.saveRelatedEntity(phone.international_number, "entity:contact", cik);
    }
  }

  // Process each issuer in item1Info
  let index = startIndex;
  for (const issuer of item1Info) {
    if (!issuer.issuerName) continue;

    await ctx.observer.observeCompany({
      accession_number: ctx.accession_number,
      extractor_id: ctx.extractor_id,
      extractor_version: ctx.extractor_version,
      observation_index: index,
      cik,
      name: issuer.issuerName,
      address_id: addr?.address_hash_id ?? null,
      international_number: phone?.international_number ?? null,
      source_context: JSON.stringify({ relation: "form-1k:issuer" }),
    });
    index++;
  }
}

async function processOfferingHistory(
  cik: number,
  file_number: string,
  accession_number: string,
  filing_date: string,
  form1K: Form1K,
  ctx: Form1KStorageContext,
  startIndex: number
): Promise<void> {
  const regARepo = new RegAOfferingRepo();
  const summaryInfoArr = form1K.formData.summaryInfo;
  if (!summaryInfoArr) return;

  let providerIdx = 0;
  for (const summaryInfo of summaryInfoArr) {
    // Use the commission file number from summary if available, otherwise fall back
    const offeringFileNumber = summaryInfo.commissionFileNumber ?? file_number;

    const history: RegAOfferingHistory = {
      cik,
      file_number: offeringFileNumber,
      accession_number,
      filing_date,
      qualification_date: summaryInfo.offeringQualificationDate ?? null,
      commence_date: summaryInfo.offeringCommenceDate ?? null,
      securities_qualified_sold: summaryInfo.qualifiedSecuritiesSold ?? null,
      securities_sold: summaryInfo.offeringSecuritiesSold ?? null,
      price_per_security: numScalar(summaryInfo.pricePerSecurity),
      aggregate_offering_price: numScalar(summaryInfo.aggregrateOfferingPrice),
      aggregate_offering_price_holders: numScalar(summaryInfo.aggregrateOfferingPriceHolders),
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

    // Process service providers for this offering
    const providers = extractServiceProviders(summaryInfo as Record<string, unknown>, "1-K");
    for (const provider of providers) {
      await regARepo.saveServiceProvider({
        cik,
        file_number: offeringFileNumber,
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
            relation: "form-1k:service-provider",
            providerType: provider.type,
          }),
        });
        providerIdx++;
      }
    }
  }
}

export async function processForm1K({
  cik,
  file_number,
  accession_number,
  filing_date,
  primary_doc,
  form1K,
}: {
  cik: number;
  file_number: string;
  accession_number: string;
  filing_date: string;
  primary_doc: string;
  /**
   * The form as filed — `1-K` or `1-K/A`. Part of the shape every extractor's
   * `store` is handed and accepted here so the dispatcher's arguments spread in
   * unchanged; nothing below distinguishes an amendment from an original,
   * because a 1-K amendment restates the same cover page.
   */
  form: string;
  form1K: ParsedForm1K;
}): Promise<void> {
  // The cover page (`primary_doc.xml`) is the whole of what a 1-K parses to
  // here — see {@link ParsedForm1K}.
  const cover = form1K.cover;
  // 1.1.0: numScalar() treats whitespace-only/empty numeric elements as null
  // instead of fabricating 0 via Value.Convert. Bumped to force re-extract.
  const extractor_version = "1.1.0";

  const observer = buildObserveOnlyEntityObserver();

  const ctx: Form1KStorageContext = {
    accession_number,
    extractor_id: "1-K",
    extractor_version,
    observer,
  };

  const regARepo = new RegAOfferingRepo();
  const item1Info = cover.formData.item1Info;
  const primaryIssuer = item1Info[0];

  // Upsert the offering. A 1-K carries no tier/SIC/audit/securities data, so
  // preserve whatever the 1-A wrote — a full-row put with nulls here clobbers
  // the tier and makes queries like `reg-a --tier Tier2 --status reporting`
  // unsatisfiable. The mutable row is latest-by-filing-date; the read-merge-write
  // is atomic per (cik, file_number) and skips stale out-of-order writes (unknown
  // "" dates apply as-is).
  await regARepo.saveOfferingAsOf(cik, file_number, filing_date, (existing) => ({
    cik,
    file_number,
    issuer_name: primaryIssuer?.issuerName ?? existing?.issuer_name ?? null,
    jurisdiction: primaryIssuer?.jurisdictionOrganization ?? existing?.jurisdiction ?? null,
    sic_code: existing?.sic_code ?? null,
    tier: existing?.tier ?? null,
    financial_statement_audit_status: existing?.financial_statement_audit_status ?? null,
    securities_offered_type: existing?.securities_offered_type ?? null,
    industry_group: existing?.industry_group ?? null,
    status: "reporting",
    as_of: filing_date || existing?.as_of || null,
  }));

  await processIssuer(cik, cover, ctx, 0);
  await processOfferingHistory(cik, file_number, accession_number, filing_date, cover, ctx, 100);
}
