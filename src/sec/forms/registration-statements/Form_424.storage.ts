/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { buildEntityObserver } from "../../../resolver/buildEntityObserver";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import type { FormS1Parsed } from "./s1/parseSubmission";
import { extractAndStoreXbrl } from "./s1/xbrlEnrichment";

const EXTRACTOR_ID = "424";
const DEFAULT_EXTRACTOR_VERSION = "1.0.0";

export interface ProcessForm424Args {
  readonly cik: number;
  readonly file_number: string;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly primary_doc: string;
  readonly form: string;
  readonly form424: FormS1Parsed;
}

/**
 * Deterministic-only processing for 424 prospectuses: run the XBRL pass
 * (final / takedown pricing arrives in the iXBRL `EX-FILING FEES` exhibit on
 * pay-as-you-go filings; the prospectus body itself is usually untagged) and
 * observe the issuer so the filing resolves to the same canonical company as
 * its registration statement. No AI section extraction.
 */
export async function processForm424(args: ProcessForm424Args): Promise<void> {
  const { cik, accession_number, form424 } = args;

  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const [extractorSlot, personSlot, companySlot] = await Promise.all([
    getActiveSlot(versionRegistry, "extractor", EXTRACTOR_ID),
    getActiveSlot(versionRegistry, "resolver", "person"),
    getActiveSlot(versionRegistry, "resolver", "company"),
  ]);
  const extractor_version = extractorSlot?.semver ?? DEFAULT_EXTRACTOR_VERSION;
  const activeResolverPersonVersion = personSlot?.semver ?? "1.0.0";
  const activeResolverCompanyVersion = companySlot?.semver ?? "1.0.0";

  const xbrl = await extractAndStoreXbrl({
    cik,
    accession_number,
    html: form424.html,
    xbrlInstanceXml: form424.xbrlInstanceXml,
    feeExhibitHtml: form424.feeExhibitHtml,
  });

  const observer = buildEntityObserver({
    activeResolverPersonVersion,
    activeResolverCompanyVersion,
  });
  const hasXbrlIssuerAttributes =
    xbrl.name !== null ||
    xbrl.jurisdiction !== null ||
    xbrl.address_id !== null ||
    xbrl.international_number !== null;
  await observer.observeCompany({
    accession_number,
    extractor_id: EXTRACTOR_ID,
    extractor_version,
    observation_index: 0,
    cik,
    name: xbrl.name,
    jurisdiction: xbrl.jurisdiction,
    address_id: xbrl.address_id,
    international_number: xbrl.international_number,
    source_context: JSON.stringify(
      hasXbrlIssuerAttributes
        ? { relation: "424:issuer", attributes_source: "xbrl-dei" }
        : { relation: "424:issuer" }
    ),
  });
}
