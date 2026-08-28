/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { buildEntityObserver } from "../../../resolver/buildEntityObserver";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import type { FormS1Parsed } from "./s1/parseSubmission";
import { extractAndStoreXbrl } from "./s1/xbrlEnrichment";

/**
 * The structured reading of a 424 prospectus: its XBRL and the issuer it
 * names. Its own id, distinct from the `424` an out-of-package extractor
 * registers for the prospectus prose, so the two hold separate version slots,
 * separate `extractor_runs` rows and separate dead letters — and so a change to
 * one never re-selects the corpus for the other.
 */
const EXTRACTOR_ID = "424-xbrl";
const DEFAULT_EXTRACTOR_VERSION = "1.0.0";

export interface ProcessForm424StructuredArgs {
  readonly cik: number;
  readonly file_number: string;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly primary_doc: string;
  readonly form: string;
  readonly form424: FormS1Parsed;
  readonly context?: IExecuteContext;
}

/**
 * Records what a 424 prospectus states as fact, for every variant: the
 * deterministic XBRL pass (fee-exhibit and inline facts) and the issuer
 * observation that resolves the filing to the same canonical company as its
 * registration statement.
 *
 * Reads no model. The priced forms (424B1 / 424B4) also carry offering terms,
 * underwriters and use of proceeds, but those are read out of prose by a model
 * and are extracted by whoever registers the `424` extractor — which may be
 * nobody, in which case a prospectus still resolves to its issuer and still
 * has its tagged facts.
 */
export async function processForm424Structured(args: ProcessForm424StructuredArgs): Promise<void> {
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

  const xbrl = await extractAndStoreXbrl({
    cik,
    accession_number,
    html: form424.html,
    xbrlInstanceXml: form424.xbrlInstanceXml,
    feeExhibitHtml: form424.feeExhibitHtml,
  });

  const observer = buildEntityObserver({
    activeResolverPersonVersion: personSlot?.semver ?? "1.0.0",
    activeResolverCompanyVersion: companySlot?.semver ?? "1.0.0",
  });
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
      xbrl.hasIssuerAttributes
        ? { relation: "424:issuer", attributes_source: "xbrl-dei" }
        : { relation: "424:issuer" }
    ),
  });
}
