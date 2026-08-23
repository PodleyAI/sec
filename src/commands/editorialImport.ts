/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse } from "csv-parse/sync";
import { normalizeSponsorFamilyName } from "../resolver/SponsorFamilyResolver";
import { normalizeUnderwriterFamilyName } from "../resolver/UnderwriterFamilyResolver";
import { FamilyDescriptionRepo } from "../storage/canonical/FamilyDescriptionRepo";
import {
  FAMILY_DESCRIPTION_KINDS,
  type FamilyDescriptionKind,
} from "../storage/canonical/FamilyDescriptionSchema";
import { SpacRepo } from "../storage/spac/SpacRepo";
import { SpacReportWriter } from "../storage/spac/SpacReportWriter";
import { usableWebsiteUrl } from "../util/websiteUrl";

/**
 * CSV import for editorial data with no SEC-filing source. Two formats,
 * detected by header:
 *
 *   `cik,name,url_spac,url_sponsor,details` — spac-row editorial fields
 *   (`name` is informational only; `details` is a JSON object). Extracted
 *   from the embarc repo's JSON by a one-off script.
 *
 *   `family_kind,name,description` — sponsor/underwriter family blurbs for
 *   the version-independent `family_description` table.
 */

export interface SpacEditorialRow {
  readonly line: number;
  readonly cik: number;
  readonly url_spac: string | undefined;
  readonly url_sponsor: string | undefined;
  readonly details: string | undefined;
}

export interface FamilyDescriptionRow {
  readonly line: number;
  readonly family_kind: FamilyDescriptionKind;
  readonly name: string;
  readonly description: string;
}

export interface ParsedEditorialCsv {
  readonly kind: "spac" | "family";
  readonly spacRows: readonly SpacEditorialRow[];
  readonly familyRows: readonly FamilyDescriptionRow[];
  readonly errors: readonly string[];
}

const SPAC_HEADER_REQUIRED = ["cik"];
const FAMILY_HEADER_REQUIRED = ["family_kind", "name", "description"];

function isHttpUrl(value: string): boolean {
  return usableWebsiteUrl(value) !== null;
}

function isJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** Normalizes a family name with the SAME normalizer the resolver/alias CLI uses. */
export function normalizeFamilyNameForKind(kind: FamilyDescriptionKind, name: string): string {
  return kind === "sponsor-family"
    ? normalizeSponsorFamilyName(name)
    : normalizeUnderwriterFamilyName(name);
}

/** Parse and validate an editorial CSV; format is detected from the header row. */
export function parseEditorialCsv(content: string): ParsedEditorialCsv {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  const header = records.length > 0 ? Object.keys(records[0]) : headerOf(content);
  const errors: string[] = [];

  if (FAMILY_HEADER_REQUIRED.every((h) => header.includes(h))) {
    const familyRows: FamilyDescriptionRow[] = [];
    records.forEach((r, i) => {
      const line = i + 2; // 1-based, after the header row
      const kind = r.family_kind as FamilyDescriptionKind;
      if (!FAMILY_DESCRIPTION_KINDS.includes(kind)) {
        errors.push(`line ${line}: unknown family_kind '${r.family_kind}'`);
        return;
      }
      if (!r.name || normalizeFamilyNameForKind(kind, r.name) === "") {
        errors.push(`line ${line}: name normalizes to empty`);
        return;
      }
      if (!r.description) {
        errors.push(`line ${line}: empty description`);
        return;
      }
      familyRows.push({ line, family_kind: kind, name: r.name, description: r.description });
    });
    return { kind: "family", spacRows: [], familyRows, errors };
  }

  if (SPAC_HEADER_REQUIRED.every((h) => header.includes(h))) {
    const spacRows: SpacEditorialRow[] = [];
    records.forEach((r, i) => {
      const line = i + 2;
      // Digits-only: `Number("")` is 0 and `Number.isInteger(0)` is true, so a
      // numeric guard alone would import a blank cell under CIK 0 — and with
      // --create-missing that mints a spac row marking CIK 0 a known SPAC.
      const cikText = (r.cik ?? "").trim();
      const cik = Number(cikText);
      if (!/^\d+$/.test(cikText) || !Number.isSafeInteger(cik)) {
        errors.push(`line ${line}: invalid cik '${r.cik}'`);
        return;
      }
      const url_spac = r.url_spac || undefined;
      const url_sponsor = r.url_sponsor || undefined;
      const details = r.details || undefined;
      if (url_spac !== undefined && !isHttpUrl(url_spac)) {
        errors.push(`line ${line}: url_spac is not an http(s) URL`);
        return;
      }
      if (url_sponsor !== undefined && !isHttpUrl(url_sponsor)) {
        errors.push(`line ${line}: url_sponsor is not an http(s) URL`);
        return;
      }
      if (details !== undefined && !isJsonObject(details)) {
        errors.push(`line ${line}: details is not a JSON object`);
        return;
      }
      if (url_spac === undefined && url_sponsor === undefined && details === undefined) {
        errors.push(`line ${line}: no editorial value set`);
        return;
      }
      spacRows.push({ line, cik, url_spac, url_sponsor, details });
    });
    return { kind: "spac", spacRows, familyRows: [], errors };
  }

  return {
    kind: "spac",
    spacRows: [],
    familyRows: [],
    errors: [
      `unrecognized header [${header.join(",")}]: expected 'cik,...' or 'family_kind,name,description'`,
    ],
  };
}

function headerOf(content: string): string[] {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.split(",").map((s) => s.trim());
}

export interface ImportSpacEditorialResult {
  readonly written: number;
  readonly created: number;
  readonly skippedMissing: readonly number[];
}

/**
 * Apply spac editorial rows via {@link SpacReportWriter.recordEditorial}. A CIK
 * with no spac row is skipped (and reported) unless `createMissing` — creating
 * a row marks the CIK a known SPAC, which gates 8-K/proxy processing, so
 * minting rows is opt-in.
 */
export async function importSpacEditorial(
  rows: readonly SpacEditorialRow[],
  opts: { readonly createMissing: boolean; readonly dryRun: boolean }
): Promise<ImportSpacEditorialResult> {
  const spacRepo = new SpacRepo();
  const writer = new SpacReportWriter();
  let written = 0;
  let created = 0;
  const skippedMissing: number[] = [];
  for (const row of rows) {
    const exists = (await spacRepo.getSpac(row.cik)) !== undefined;
    if (!exists && !opts.createMissing) {
      skippedMissing.push(row.cik);
      continue;
    }
    if (!opts.dryRun) {
      await writer.recordEditorial({
        cik: row.cik,
        url_spac: row.url_spac,
        url_sponsor: row.url_sponsor,
        details: row.details,
      });
    }
    written++;
    if (!exists) created++;
  }
  return { written, created, skippedMissing };
}

/** Apply family-description rows to the version-independent `family_description` table. */
export async function importFamilyDescriptions(
  rows: readonly FamilyDescriptionRow[],
  opts: { readonly dryRun: boolean }
): Promise<{ readonly written: number }> {
  const repo = new FamilyDescriptionRepo();
  let written = 0;
  for (const row of rows) {
    if (!opts.dryRun) {
      await repo.setDescription(
        row.family_kind,
        normalizeFamilyNameForKind(row.family_kind, row.name),
        row.description
      );
    }
    written++;
  }
  return { written };
}
