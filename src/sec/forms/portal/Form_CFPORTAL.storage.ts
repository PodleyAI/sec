/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, TaskAbortedError } from "workglow";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { resolveCountryCode } from "../../../storage/address/resolveCountryCode";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import { PortalRepo } from "../../../storage/portal/PortalRepo";
import { recordSuccessions } from "./portalSuccession";
import { CanonicalCompanyAddressRepo } from "../../../storage/canonical/CanonicalCompanyAddressRepo";
import { CanonicalCompanyAliasRepo } from "../../../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalCompanyPhoneRepo } from "../../../storage/canonical/CanonicalCompanyPhoneRepo";
import { PersonRoleRepo } from "../../../storage/canonical/PersonRoleRepo";
import { CanonicalCompanyRepo } from "../../../storage/canonical/CanonicalCompanyRepo";
import { CanonicalPersonAddressRepo } from "../../../storage/canonical/CanonicalPersonAddressRepo";
import { CanonicalPersonAliasRepo } from "../../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalPersonPhoneRepo } from "../../../storage/canonical/CanonicalPersonPhoneRepo";
import { CanonicalPersonRepo } from "../../../storage/canonical/CanonicalPersonRepo";
import { CompanyIdentityLinkRepo } from "../../../storage/canonical/CompanyIdentityLinkRepo";
import { PersonIdentityLinkRepo } from "../../../storage/canonical/PersonIdentityLinkRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { PersonObservationTitleRepo } from "../../../storage/observation/PersonObservationTitleRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { CompanyResolver } from "../../../resolver/CompanyResolver";
import { EntityObserver } from "../../../resolver/EntityObserver";
import { PersonResolver } from "../../../resolver/PersonResolver";
import { hasCompanyEnding } from "../../../storage/company/CompanyNormalization";
import { parseCikSafely } from "../../../util/parseCik";
import type { FormCfportal } from "./Form_CFPORTAL.schema";

const EXTRACTOR_ID = "CFPORTAL" as const;
const EXTRACTOR_VERSION = "1.0.0";

/**
 * "Last, First, Middle" is the CFPORTAL Schedule A natural-person name
 * format; plain "First Last" strings also occur. Splitting here keeps the
 * comma format out of the person normalizer, which would otherwise read the
 * third segment as a suffix.
 */
function splitScheduleAName(fullLegalName: string): {
  first_name: string | null;
  middle_name: string | null;
  last_name: string;
} {
  if (!fullLegalName.includes(",")) {
    return { first_name: null, middle_name: null, last_name: fullLegalName };
  }
  const parts = fullLegalName.split(",").map((p) => p.trim());
  return {
    last_name: parts[0] || fullLegalName,
    first_name: parts[1] || null,
    middle_name: parts[2] || null,
  };
}

/** EDGAR pads "no CRD" as a string of zeros; treat those as absent. */
function crdOrNull(crdNumber: string | undefined): string | null {
  if (!crdNumber || /^0+$/.test(crdNumber)) return null;
  return crdNumber;
}

export async function processFormCFPORTAL({
  cik,
  accession_number,
  filing_date,
  formCfportal,
}: {
  cik: number;
  accession_number: string;
  filing_date: string;
  formCfportal: FormCfportal;
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

  const canonicalPersonRepo = new CanonicalPersonRepo();
  const canonicalCompanyRepo = new CanonicalCompanyRepo();
  const observer = new EntityObserver({
    personObservationRepo: new PersonObservationRepo(),
    personObservationTitleRepo: new PersonObservationTitleRepo(),
    companyObservationRepo: new CompanyObservationRepo(),
    personIdentityLinkRepo: new PersonIdentityLinkRepo(),
    companyIdentityLinkRepo: new CompanyIdentityLinkRepo(),
    personResolver: new PersonResolver({
      canonicalPersonRepo,
      canonicalPersonAliasRepo: new CanonicalPersonAliasRepo(),
      activeResolverVersion: activeResolverPersonVersion,
    }),
    companyResolver: new CompanyResolver({
      canonicalCompanyRepo,
      canonicalCompanyAliasRepo: new CanonicalCompanyAliasRepo(),
      activeResolverVersion: activeResolverCompanyVersion,
    }),
    canonicalPersonAddressRepo: new CanonicalPersonAddressRepo(),
    canonicalPersonPhoneRepo: new CanonicalPersonPhoneRepo(),
    canonicalCompanyAddressRepo: new CanonicalCompanyAddressRepo(),
    canonicalCompanyPhoneRepo: new CanonicalCompanyPhoneRepo(),
    personRoleRepo: new PersonRoleRepo(),
    activeResolverPersonVersion,
    activeResolverCompanyVersion,
  });

  const submissionType = formCfportal.headerData.submissionType;
  const identifying = formCfportal.formData?.identifyingInformation;
  const aliases = identifying?.otherNamesAndWebsiteUrls ?? [];
  // Entries may carry only a name or only a URL; take the first of each.
  const brand = aliases.find((a) => a.otherNamesUsedPortal)?.otherNamesUsedPortal ?? null;
  const url = aliases.find((a) => a.webSiteOfPortal)?.webSiteOfPortal ?? null;

  const portalRepo = new PortalRepo();
  const isWithdrawal = submissionType === "CFPORTAL-W";

  // The mutable row reflects the latest filing by *filing date*, not by
  // processing order — a back-catalog replay of the original registration must
  // not resurrect a withdrawn portal. The read-merge-write is atomic per CIK and
  // skips stale out-of-order writes (an undated "" filing is treated as stale).
  // Absent fields inherit from the existing portal row — a CFPORTAL/A may omit
  // identifying info the registered portal still carries; a fresh CFPORTAL with
  // an absent field stays null. Observations below are keyed by accession and
  // always record the older filing too.
  const hasName = identifying?.nameOfPortal !== undefined;
  await portalRepo.savePortalAsOf(cik, filing_date, (existing) => ({
    cik,
    name: hasName ? (identifying!.nameOfPortal ?? null) : (existing?.name ?? null),
    brand: brand ?? existing?.brand ?? null,
    url: url ?? existing?.url ?? null,
    live: !isWithdrawal,
    // Carried, never recomputed here: this row is the SUCCESSOR's, and the
    // pointer belongs to whichever predecessor a succession block names.
    succeeded_by_cik: existing?.succeeded_by_cik ?? null,
    as_of: filing_date || existing?.as_of || null,
  }));

  // Successions run after the portal row so a filing that both registers a
  // portal and succeeds another has its own row in place first. Failures are
  // contained: a filer's succession claim is worth less than its registration,
  // and losing the whole filing over one is the wrong trade.
  try {
    await recordSuccessions({ cik, accession_number, filing_date, formCfportal });
  } catch (error) {
    // A cooperative cancellation is not a per-claim failure: it must stop the
    // sweep rather than be logged and passed over.
    if (error instanceof TaskAbortedError) throw error;
    console.warn(`Failed to record successions for portal ${cik}:`, error);
  }

  // Observation tier. Index layout: 0 = the portal company itself,
  // 1 = contact employee, 100+ = Schedule A direct/indirect owners.
  const addressRepo = new AddressRepo();
  let portalAddressId: string | null = null;
  if (identifying?.portalAddress) {
    try {
      const saved = await addressRepo.saveAddress(identifying.portalAddress);
      portalAddressId = saved.address_hash_id;
    } catch (error) {
      console.warn(`Failed to save address for portal ${identifying?.nameOfPortal}:`, error);
    }
  }

  const phoneRepo = new PhoneRepo();

  // The portal's OWN number, from the same identifying block as its address.
  let portalPhone: Awaited<ReturnType<PhoneRepo["savePhoneIfUsable"]>> = undefined;
  const portalPhoneRaw = identifying?.portalContact?.portalContactPhone;
  if (portalPhoneRaw) {
    portalPhone = await phoneRepo.savePhoneIfUsable({
      phone_raw: portalPhoneRaw,
      country_code: resolveCountryCode(identifying?.portalAddress?.stateOrCountry),
    });
    if (portalPhone) {
      await phoneRepo.saveRelatedEntity(portalPhone.international_number, "entity:contact", cik);
    }
  }

  // The escrow agent's number, which is NOT the portal's and must never be
  // junctioned as though it were.
  //
  // It lives under `escrowArrangements`, and the data says the same: across all
  // 817 cached CFPORTAL filings, 786 carry both numbers and 772 of them (99%)
  // differ. The escrow numbers are shared infrastructure — one is on 46
  // distinct portal CIKs, another on 29 — so filing them under
  // `entity:contact` would hand 46 portals the same switchboard as their own.
  // A distinct relation keeps the number discoverable without asserting whose
  // it is. (The agent itself is a company this does not yet observe;
  // `investorFundsContactName` and `investorFundsAddress` are the makings of
  // that, and it is a larger change than storing the phone.)
  for (const escrow of formCfportal.formData?.escrowArrangements?.investorFundsContacts ?? []) {
    if (!escrow.investorFundsContactPhone) continue;
    const escrowPhone = await phoneRepo.savePhoneIfUsable({
      phone_raw: escrow.investorFundsContactPhone,
      country_code: resolveCountryCode(escrow.investorFundsAddress?.stateOrCountry),
    });
    if (escrowPhone) {
      await phoneRepo.saveRelatedEntity(
        escrowPhone.international_number,
        "portal:investor-funds",
        cik
      );
    }
  }

  if (identifying?.nameOfPortal) {
    await observer.observeCompany({
      accession_number,
      extractor_id: EXTRACTOR_ID,
      extractor_version: EXTRACTOR_VERSION,
      observation_index: 0,
      cik,
      name: identifying.nameOfPortal,
      address_id: portalAddressId,
      international_number: portalPhone?.international_number ?? null,
      source_context: JSON.stringify({ relation: "cfportal:portal" }),
    });
  }

  const contact = identifying?.contactEmployeeName;
  if (contact?.lastName) {
    await observer.observePerson({
      accession_number,
      extractor_id: EXTRACTOR_ID,
      extractor_version: EXTRACTOR_VERSION,
      observation_index: 1,
      source_filing_issuer_cik: cik,
      first_name: contact.firstName ?? null,
      middle_name: contact.middleName ?? null,
      last_name: contact.lastName,
      suffix: contact.suffix ?? null,
      titles: identifying?.contactEmployeeTitle ? [identifying.contactEmployeeTitle] : null,
      relationship: "cfportal:contact",
      filing_date,
      role_scope: "cfportal:contact",
      source_context: JSON.stringify({ relation: "cfportal:contact" }),
    });
  }

  // Observation indexes are positional (100 + schedule position) so they stay
  // stable when a previously unparseable owner row becomes parseable later —
  // upsertByNaturalKey would otherwise shift every subsequent owner.
  const owners = formCfportal.formData?.scheduleA?.entityOrNaturalPerson ?? [];
  for (let i = 0; i < owners.length; i++) {
    const owner = owners[i];
    if (!owner.fullLegalName) continue;
    const index = 100 + i;
    const source_context = JSON.stringify({
      relation: "cfportal:owner",
      titles: owner.titleStatus ? [owner.titleStatus] : [],
      ownershipCode: owner.ownershipCode ?? null,
      controlPerson: owner.controlPerson ?? null,
    });
    // entityType is optional in the schema. When absent and neither CIK nor
    // CRD is provided, prefer person: natural persons rarely carry CIK/CRD
    // on Schedule A, and "John Smith Holdings LLC" otherwise trips the
    // company-ending heuristic and contaminates the canonical company pool.
    // When at least one identifier is present we keep the hasCompanyEnding
    // tiebreaker.
    const ownerCikRaw = parseCikSafely(owner.cikNumber);
    const ownerCrdNormalized = crdOrNull(owner.crdNumber);
    const hasAnyIdentifier = ownerCikRaw > 0 || ownerCrdNormalized !== null;
    const isNaturalPerson =
      owner.entityType === "NP" ||
      (owner.entityType === undefined &&
        (!hasAnyIdentifier || !hasCompanyEnding(owner.fullLegalName)));
    if (isNaturalPerson) {
      const name = splitScheduleAName(owner.fullLegalName);
      await observer.observePerson({
        accession_number,
        extractor_id: EXTRACTOR_ID,
        extractor_version: EXTRACTOR_VERSION,
        observation_index: index,
        source_filing_issuer_cik: cik,
        first_name: name.first_name,
        middle_name: name.middle_name,
        last_name: name.last_name,
        titles: owner.titleStatus ? [owner.titleStatus] : null,
        relationship: "cfportal:owner",
        filing_date,
        role_scope: "cfportal:owner",
        source_context,
      });
    } else {
      await observer.observeCompany({
        accession_number,
        extractor_id: EXTRACTOR_ID,
        extractor_version: EXTRACTOR_VERSION,
        observation_index: index,
        cik: ownerCikRaw > 0 ? ownerCikRaw : null,
        crd_number: ownerCrdNormalized,
        name: owner.fullLegalName,
        source_context,
      });
    }
  }
}
