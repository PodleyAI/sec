/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { streamMatchingRows } from "../cli/queries/_streamMatches";
import { AccreditedPortalSignalRepo } from "../storage/accredited-portal/AccreditedPortalSignalRepo";
import type { AccreditedPortalSignalType } from "../storage/accredited-portal/AccreditedPortalSignalSchema";
import { COMPANY_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/CompanyObservationSchema";
import { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/PersonObservationSchema";
import { isBadPersonField } from "../types/edgar/bad-data";
import { isAttributableRelation, signalKeyOf } from "./PortalAttributor";

export interface PortalSignalSuggestion {
  readonly signal_type: AccreditedPortalSignalType;
  readonly signal_value: string;
  /** Distinct Form D accessions the fingerprint appears in. */
  readonly filings: number;
  /** Up to three distinct entity names seen alongside the fingerprint. */
  readonly sample_names: readonly string[];
}

function relationOf(source_context: string | null | undefined): string {
  if (!source_context) return "form-d:unknown";
  try {
    const parsed = JSON.parse(source_context);
    return typeof parsed?.relation === "string" ? parsed.relation : "form-d:unknown";
  } catch {
    return "form-d:unknown";
  }
}

interface ObservationFacts {
  readonly accession_number: string;
  readonly display_name: string | null;
  readonly values: readonly { type: AccreditedPortalSignalType; value: string }[];
}

/**
 * Streams both observation tables (extractor "D") and reduces each row to the
 * address/phone fingerprint values it carries. Names are deliberately not
 * suggested — an entity name shared across many filings is usually a genuine
 * serial filer, whereas a reused back-office address or phone is the SPV
 * "factory" pattern that identifies a portal.
 */
async function forEachObservationFacts(handle: (facts: ObservationFacts) => void): Promise<void> {
  const companyRepo = globalServiceRegistry.get(COMPANY_OBSERVATION_REPOSITORY_TOKEN);
  for await (const obs of streamMatchingRows(companyRepo, { extractor_id: "D" }, () => true)) {
    if (!isAttributableRelation(relationOf(obs.source_context))) continue;
    const values: { type: AccreditedPortalSignalType; value: string }[] = [];
    if (obs.raw_address_id) values.push({ type: "address", value: obs.raw_address_id });
    if (obs.raw_phone_id) values.push({ type: "phone", value: obs.raw_phone_id });
    if (values.length > 0) {
      handle({
        accession_number: obs.accession_number,
        display_name: obs.name ?? obs.normalized_name ?? null,
        values,
      });
    }
  }
  const personRepo = globalServiceRegistry.get(PERSON_OBSERVATION_REPOSITORY_TOKEN);
  for await (const obs of streamMatchingRows(personRepo, { extractor_id: "D" }, () => true)) {
    if (!isAttributableRelation(relationOf(obs.source_context))) continue;
    const values: { type: AccreditedPortalSignalType; value: string }[] = [];
    if (obs.raw_address_id) values.push({ type: "address", value: obs.raw_address_id });
    if (obs.raw_phone_id) values.push({ type: "phone", value: obs.raw_phone_id });
    if (values.length > 0) {
      const name = [obs.first_name, obs.middle_name, obs.last_name]
        .filter((part): part is string => Boolean(part) && !isBadPersonField(part!))
        .join(" ");
      handle({
        accession_number: obs.accession_number,
        display_name: name || null,
        values,
      });
    }
  }
}

/**
 * Surfaces address/phone values that recur across many distinct Form D
 * filings but are not yet curated as portal signals — the SPV-factory
 * fingerprints ("many funds, one back office") that identify an
 * accredited-investor portal. Two streaming passes: a counting pass
 * (per-accession deduped via the last-seen accession, exploiting that one
 * filing's observations are written contiguously), then an exact pass over
 * the shortlist collecting distinct-accession counts and sample names.
 * Curation stays manual: suggestions are a worklist, not auto-added signals.
 */
export async function suggestPortalSignals(options: {
  minFilings?: number;
  limit?: number;
}): Promise<PortalSignalSuggestion[]> {
  const minFilings = options.minFilings ?? 3;
  const limit = options.limit ?? 25;

  const existing = new Set(
    (await new AccreditedPortalSignalRepo().getAllSignals()).map((s) =>
      signalKeyOf(s.signal_type, s.signal_value)
    )
  );

  const counts = new Map<string, { n: number; lastAccession: string }>();
  await forEachObservationFacts((facts) => {
    for (const { type, value } of facts.values) {
      const key = signalKeyOf(type, value);
      if (existing.has(key)) continue;
      const entry = counts.get(key);
      if (!entry) {
        counts.set(key, { n: 1, lastAccession: facts.accession_number });
      } else if (entry.lastAccession !== facts.accession_number) {
        entry.n += 1;
        entry.lastAccession = facts.accession_number;
      }
    }
  });

  const shortlist = new Set(
    [...counts.entries()]
      .filter(([, entry]) => entry.n >= minFilings)
      .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([key]) => key)
  );
  if (shortlist.size === 0) return [];

  const details = new Map<string, { accessions: Set<string>; names: Set<string> }>();
  await forEachObservationFacts((facts) => {
    for (const { type, value } of facts.values) {
      const key = signalKeyOf(type, value);
      if (!shortlist.has(key)) continue;
      let detail = details.get(key);
      if (!detail) {
        detail = { accessions: new Set(), names: new Set() };
        details.set(key, detail);
      }
      detail.accessions.add(facts.accession_number);
      if (facts.display_name && detail.names.size < 3) {
        detail.names.add(facts.display_name);
      }
    }
  });

  return [...details.entries()]
    .map(([key, detail]) => {
      const separator = key.indexOf("|");
      return {
        signal_type: key.slice(0, separator) as AccreditedPortalSignalType,
        signal_value: key.slice(separator + 1),
        filings: detail.accessions.size,
        sample_names: [...detail.names],
      };
    })
    .filter((s) => s.filings >= minFilings)
    .sort((a, b) => b.filings - a.filings || a.signal_value.localeCompare(b.signal_value));
}
