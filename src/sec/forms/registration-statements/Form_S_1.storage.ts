/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { buildObserveOnlyEntityObserver } from "../../../resolver/buildObserveOnlyEntityObserver";
import { S1ClassificationRepo } from "../../../storage/classification/S1ClassificationRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import type { FormS1Parsed } from "./Form_S_1";
import { extractAndStoreXbrl } from "./s1/xbrlEnrichment";

/**
 * The structured reading of a registration statement: its XBRL, the issuer it
 * names, and what its SGML header says the filer's industry is. Its own id,
 * distinct from the `S-1` an out-of-package extractor registers for the
 * prospectus prose, so the two hold separate version slots, separate
 * `extractor_runs` rows and separate dead letters.
 */
const EXTRACTOR_ID = "S-1-xbrl";
const DEFAULT_EXTRACTOR_VERSION = "1.0.0";

/** SIC code EDGAR assigns to blank-check companies. */
const BLANK_CHECK_SIC = 6770;

export interface ProcessFormS1StructuredArgs {
  readonly cik: number;
  readonly file_number: string;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly primary_doc: string;
  readonly form: string;
  readonly formS1: FormS1Parsed;
  readonly context?: IExecuteContext;
}

/**
 * Records what a registration statement states as fact: the deterministic
 * iXBRL/XBRL pass over the prospectus body and its fee exhibit, the issuer
 * observation those dei cover-page facts enrich, and the header-SIC
 * classification.
 *
 * Reads no model, and reads no prose. Whether the summary actually describes a
 * blank check — which can overturn the header either way — is a reading of the
 * document, and belongs to whoever registers the `S-1` extractor. The row
 * written here is what the header asserts, under this extractor's own id, so a
 * package that ships no prose extractor still has a classification to screen
 * SPAC candidates with.
 */
export async function processFormS1Structured(args: ProcessFormS1StructuredArgs): Promise<void> {
  const { cik, accession_number, formS1 } = args;

  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const extractorSlot = await getActiveSlot(versionRegistry, "extractor", EXTRACTOR_ID);
  const extractor_version = extractorSlot?.semver ?? DEFAULT_EXTRACTOR_VERSION;

  const xbrl = await extractAndStoreXbrl({
    cik,
    accession_number,
    html: formS1.html,
    xbrlInstanceXml: formS1.xbrlInstanceXml,
    feeExhibitHtml: formS1.feeExhibitHtml,
  });

  const observer = buildObserveOnlyEntityObserver();
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
        ? { relation: "s1:issuer", attributes_source: "xbrl-dei" }
        : { relation: "s1:issuer" }
    ),
  });

  const headerSic = formS1.header?.sic ?? null;
  await new S1ClassificationRepo().save({
    extractor_id: EXTRACTOR_ID,
    accession_number,
    cik,
    sic: headerSic,
    sic_description: formS1.header?.sicDescription ?? null,
    is_spac: headerSic === BLANK_CHECK_SIC,
    classifier_source: headerSic === null ? "sic-unknown" : "sgml-header",
    created_at: new Date().toISOString(),
  });
}
