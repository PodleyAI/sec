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
import type { FormCfportal } from "./Form_CFPORTAL.schema";

const EXTRACTOR_ID = "CFPORTAL" as const;
const EXTRACTOR_VERSION = "1.0.0";

export async function processFormCFPORTAL({
  cik,
  file_number,
  accession_number,
  filing_date,
  primary_doc,
  formCfportal,
}: {
  cik: number;
  file_number: string;
  accession_number: string;
  filing_date: string;
  primary_doc: string;
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
  const firstAlias = identifying?.otherNamesAndWebsiteUrls?.[0];

  const portalRepo = new PortalRepo();
  const existing = await portalRepo.getPortal(cik);
  await portalRepo.savePortal({
    cik,
    // A withdrawal carries a stripped formData; keep the registered identity.
    name: identifying?.nameOfPortal ?? existing?.name ?? null,
    brand: firstAlias?.otherNamesUsedPortal ?? existing?.brand ?? null,
    url: firstAlias?.webSiteOfPortal ?? existing?.url ?? null,
    live: submissionType !== "CFPORTAL-W",
  });

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
      title: identifying?.contactEmployeeTitle ?? null,
      relationship: "cfportal:contact",
      source_context: JSON.stringify({ relation: "cfportal:contact" }),
    });
  }

  const owners = formCfportal.formData?.scheduleA?.entityOrNaturalPerson ?? [];
  let index = 100;
  for (const owner of owners) {
    if (!owner.fullLegalName) continue;
    const source_context = JSON.stringify({
      relation: "cfportal:owner",
      titles: owner.titleStatus ? [owner.titleStatus] : [],
      ownershipCode: owner.ownershipCode ?? null,
      controlPerson: owner.controlPerson ?? null,
    });
    if (owner.entityType === "NP") {
      await observer.observePerson({
        accession_number,
        extractor_id: EXTRACTOR_ID,
        extractor_version: EXTRACTOR_VERSION,
        observation_index: index,
        source_filing_issuer_cik: cik,
        last_name: owner.fullLegalName,
        title: owner.titleStatus ?? null,
        relationship: "cfportal:owner",
        source_context,
      });
    } else {
      await observer.observeCompany({
        accession_number,
        extractor_id: EXTRACTOR_ID,
        extractor_version: EXTRACTOR_VERSION,
        observation_index: index,
        cik: null,
        name: owner.fullLegalName,
        source_context,
      });
    }
    index++;
  }
}
