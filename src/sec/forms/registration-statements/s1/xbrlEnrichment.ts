/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AddressRepo } from "../../../../storage/address/AddressRepo";
import { PhoneRepo } from "../../../../storage/phone/PhoneRepo";
import { XbrlFactRepo } from "../../../../storage/xbrl/XbrlFactRepo";
import { extractXbrlCoverPage } from "../../../xbrl/coverPage";
import { parseInlineXbrl } from "../../../xbrl/parseInlineXbrl";
import { parseXbrlInstance } from "../../../xbrl/parseXbrlInstance";
import { toXbrlFactRows } from "../../../xbrl/toFactRows";

/** Deterministic issuer attributes recovered from a filing's XBRL dei facts. */
export interface XbrlIssuerEnrichment {
  readonly hasXbrl: boolean;
  readonly factCount: number;
  /** True when at least one dei attribute below was recovered for the issuer. */
  readonly hasIssuerAttributes: boolean;
  readonly name: string | null;
  readonly jurisdiction: string | null;
  readonly address_id: string | null;
  readonly international_number: string | null;
}

const NO_XBRL: XbrlIssuerEnrichment = {
  hasXbrl: false,
  factCount: 0,
  hasIssuerAttributes: false,
  name: null,
  jurisdiction: null,
  address_id: null,
  international_number: null,
};

/**
 * Parses the filing's XBRL (inline iXBRL from the primary-doc HTML, falling
 * back to a standalone instance document), persists every fact, and returns
 * dei cover-page attributes for the issuer company observation. Never throws:
 * XBRL is an enrichment, so any failure degrades to "no XBRL" rather than
 * aborting the filing.
 */
export async function extractAndStoreXbrl(args: {
  readonly cik: number;
  readonly accession_number: string;
  readonly html: string;
  readonly xbrlInstanceXml: string | null;
  readonly feeExhibitHtml: string | null;
}): Promise<XbrlIssuerEnrichment> {
  const { cik, accession_number, html, xbrlInstanceXml, feeExhibitHtml } = args;
  try {
    // Callers hand through parser output; tolerate malformed shapes (tests and
    // legacy call sites may omit fields) rather than relying on the catch below.
    let doc = parseInlineXbrl(typeof html === "string" ? html : "");
    if (!doc.hasXbrl && typeof xbrlInstanceXml === "string") {
      doc = parseXbrlInstance(xbrlInstanceXml);
    }

    // The EX-FILING FEES exhibit (ffd-taxonomy fee table) is its own iXBRL
    // document; its facts are appended under the same accession with their
    // fact_index continuing after the primary document's.
    const rows = doc.hasXbrl ? toXbrlFactRows({ doc, accession_number, cik }) : [];
    let coverDoc = doc.hasXbrl ? doc : null;
    if (typeof feeExhibitHtml === "string") {
      const feeDoc = parseInlineXbrl(feeExhibitHtml);
      if (feeDoc.hasXbrl) {
        const offset = rows.length;
        rows.push(
          ...toXbrlFactRows({ doc: feeDoc, accession_number, cik }).map((r) => ({
            ...r,
            fact_index: r.fact_index + offset,
            source: "fee-exhibit",
          }))
        );
        // A fee exhibit also tags dei registrant facts; for filings whose
        // prospectus body is untagged (typical 424s) it is the only dei source.
        if (coverDoc === null) coverDoc = feeDoc;
      }
    }
    if (rows.length === 0) return NO_XBRL;
    await new XbrlFactRepo().replaceForAccession(accession_number, rows);

    if (coverDoc === null) {
      return { ...NO_XBRL, hasXbrl: true, factCount: rows.length };
    }

    const cover = extractXbrlCoverPage(coverDoc);

    // The dei registrant CIK must match the filing's CIK before cover-page
    // attributes are attached to the issuer (a wrong-entity exhibit or
    // instance must not rename the issuer); the facts stay stored either way.
    if (cover.centralIndexKey !== null && cover.centralIndexKey !== cik) {
      console.warn(
        `XBRL dei CIK ${cover.centralIndexKey} != filing CIK ${cik} for ${accession_number}; skipping issuer enrichment`
      );
      return { ...NO_XBRL, hasXbrl: true, factCount: rows.length };
    }

    let address_id: string | null = null;
    if (cover.addressLine1 !== null || cover.city !== null) {
      try {
        const saved = await new AddressRepo().saveAddress({
          street1: cover.addressLine1,
          street2: cover.addressLine2,
          city: cover.city,
          stateOrCountry: cover.stateOrProvince ?? cover.country,
          zipCode: cover.postalZipCode,
        });
        address_id = saved.address_hash_id;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`XBRL dei address for ${accession_number} did not normalize: ${message}`);
      }
    }

    let international_number: string | null = null;
    if (cover.localPhoneNumber !== null) {
      const phone_raw = [cover.cityAreaCode, cover.localPhoneNumber].filter(Boolean).join(" ");
      try {
        const saved = await new PhoneRepo().savePhone({ phone_raw });
        international_number = saved.international_number;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `XBRL dei phone "${phone_raw}" for ${accession_number} did not normalize: ${message}`
        );
      }
    }

    const name = cover.registrantName;
    const jurisdiction = cover.incorporationStateCountryCode;
    return {
      hasXbrl: true,
      factCount: rows.length,
      hasIssuerAttributes:
        name !== null ||
        jurisdiction !== null ||
        address_id !== null ||
        international_number !== null,
      name,
      jurisdiction,
      address_id,
      international_number,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`XBRL extraction failed for ${accession_number}: ${message}`);
    return NO_XBRL;
  }
}
