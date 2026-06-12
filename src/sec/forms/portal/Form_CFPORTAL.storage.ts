/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { PortalRepo } from "../../../storage/portal/PortalRepo";
import { CanonicalCompanyAddressRepo } from "../../../storage/canonical/CanonicalCompanyAddressRepo";
import { CanonicalCompanyAliasRepo } from "../../../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalCompanyPhoneRepo } from "../../../storage/canonical/CanonicalCompanyPhoneRepo";
import { CanonicalCompanyRepo } from "../../../storage/canonical/CanonicalCompanyRepo";
import { CanonicalPersonAddressRepo } from "../../../storage/canonical/CanonicalPersonAddressRepo";
import { CanonicalPersonAliasRepo } from "../../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalPersonPhoneRepo } from "../../../storage/canonical/CanonicalPersonPhoneRepo";
import { CanonicalPersonRepo } from "../../../storage/canonical/CanonicalPersonRepo";
import { CompanyIdentityLinkRepo } from "../../../storage/canonical/CompanyIdentityLinkRepo";
import { PersonIdentityLinkRepo } from "../../../storage/canonical/PersonIdentityLinkRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
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
  const existing = await portalRepo.getPortal(cik);

  // The mutable row reflects the latest filing by *filing date*, not by
  // processing order — a back-catalog replay of the original registration
  // must not resurrect a withdrawn portal. An undated incoming filing ("")
  // cannot be ordered against a dated existing row and is treated as
  // stale, so a filer error with no SGML date in the header does not
  // clobber a known-dated mutable row. (When the existing row is also
  // undated or absent, an undated filing still applies — there's nothing
  // to regress.) Observations below are keyed by accession and always
  // record the older filing too.
  const isStale =
    existing?.as_of != null &&
    existing.as_of !== "" &&
    (filing_date === "" || filing_date < existing.as_of);

  if (!isStale) {
    // Absent fields inherit from the existing portal row — a CFPORTAL/A may
    // omit identifying info the registered portal still carries. A fresh
    // CFPORTAL with an absent field stays null (no existing row).
    const hasName = identifying?.nameOfPortal !== undefined;
    await portalRepo.savePortal({
      cik,
      name: hasName ? (identifying!.nameOfPortal ?? null) : (existing?.name ?? null),
      brand: brand ?? existing?.brand ?? null,
      url: url ?? existing?.url ?? null,
      live: !isWithdrawal,
      as_of: filing_date || existing?.as_of || null,
    });
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

  if (identifying?.nameOfPortal) {
    await observer.observeCompany({
      accession_number,
      extractor_id: EXTRACTOR_ID,
      extractor_version: EXTRACTOR_VERSION,
      observation_index: 0,
      cik,
      name: identifying.nameOfPortal,
      address_id: portalAddressId,
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
      title: identifying?.contactEmployeeTitle ?? null,
      relationship: "cfportal:contact",
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
    // entityType is optional in the schema; when absent, fall back to the
    // same company-ending heuristic Form C uses for signature names.
    const isNaturalPerson =
      owner.entityType === "NP" ||
      (owner.entityType === undefined && !hasCompanyEnding(owner.fullLegalName));
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
        title: owner.titleStatus ?? null,
        relationship: "cfportal:owner",
        source_context,
      });
    } else {
      const ownerCik = parseCikSafely(owner.cikNumber);
      await observer.observeCompany({
        accession_number,
        extractor_id: EXTRACTOR_ID,
        extractor_version: EXTRACTOR_VERSION,
        observation_index: index,
        cik: ownerCik > 0 ? ownerCik : null,
        crd_number: crdOrNull(owner.crdNumber),
        name: owner.fullLegalName,
        source_context,
      });
    }
  }
}
