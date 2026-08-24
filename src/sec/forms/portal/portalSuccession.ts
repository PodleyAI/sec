/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { PortalRepo } from "../../../storage/portal/PortalRepo";
import {
  PORTAL_SUCCESSION_REPOSITORY_TOKEN,
  type PortalSuccession,
} from "../../../storage/portal/PortalSuccessionSchema";
import {
  buildPortalFileNumberIndex,
  normalizePortalFileNumber,
} from "../../../storage/portal/portalFileNumberIndex";
import type { FormCfportal } from "./Form_CFPORTAL.schema";

/** One acquired-portal entry, resolved as far as the filing allows. */
export interface ResolvedSuccession {
  readonly detail_index: number;
  readonly predecessor_name: string | null;
  readonly predecessor_file_number: string | null;
  readonly predecessor_cik: number | null;
}

/**
 * Reads the Item 1 successions block and resolves each acquired portal's file
 * number to a CIK.
 *
 * Only a filing that answers `Y` produces rows: the row exists to state a
 * succession, and every other filing already says there was none.
 *
 * Resolution is by **file number only**. `acquiredFundingPortal` is free text —
 * one committed filing names a predecessor ("Silicon Prairie Holdings Inc.")
 * that has no CIK in the funding-portal index at all — and a name match would
 * have to guess. An unresolved claim is kept with a null `predecessor_cik`.
 */
export async function resolveSuccessions(
  formCfportal: FormCfportal,
  fileNumberIndex: Map<string, number>
): Promise<ResolvedSuccession[]> {
  const successions = formCfportal.formData?.successions;
  if (successions?.isSucceedingBusiness !== "Y") return [];
  const details = successions.acquiredHistoryDetails ?? [];

  const out: ResolvedSuccession[] = [];
  for (let i = 0; i < details.length; i++) {
    const detail = details[i]!;
    const fileNumber = detail.acquiredPortalFileNumber?.trim() || null;
    const key = normalizePortalFileNumber(fileNumber);
    out.push({
      detail_index: i,
      predecessor_name: detail.acquiredFundingPortal?.trim() || null,
      predecessor_file_number: fileNumber,
      predecessor_cik: (key === undefined ? undefined : fileNumberIndex.get(key)) ?? null,
    });
  }
  return out;
}

/**
 * Records this filing's succession claims and points the predecessor's portal
 * row forward to the filer.
 *
 * The pointer is set only when the resolved CIK is **different** from the
 * filer's own. Three of the four `Y` answers in the whole funding-portal
 * universe are self-referential — a rename EDGAR handled by keeping the CIK —
 * and those produce no duplicate registration, so treating them as a
 * continuation would retire a filer that is still the same live portal.
 *
 * Writing the pointer onto the predecessor rather than the successor is what
 * lets a consumer walk forward from any CIK it holds without a second lookup,
 * and it leaves the surviving row untouched.
 *
 * A missing predecessor row is not an error: the acquired portal's own
 * CFPORTAL filings may not be ingested yet. The claim is stored either way, so
 * a later sweep can re-derive the pointer.
 */
export async function recordSuccessions({
  cik,
  accession_number,
  filing_date,
  formCfportal,
  fileNumberIndex,
}: {
  cik: number;
  accession_number: string;
  filing_date: string;
  formCfportal: FormCfportal;
  fileNumberIndex?: Map<string, number> | undefined;
}): Promise<ResolvedSuccession[]> {
  const successions = formCfportal.formData?.successions;
  if (successions?.isSucceedingBusiness !== "Y") return [];

  const index = fileNumberIndex ?? (await buildPortalFileNumberIndex());
  const resolved = await resolveSuccessions(formCfportal, index);
  if (resolved.length === 0) return [];

  const repo = globalServiceRegistry.get(PORTAL_SUCCESSION_REPOSITORY_TOKEN);
  const now = new Date().toISOString();
  const details = successions.acquiredHistoryDetails ?? [];
  const rows: PortalSuccession[] = resolved.map((entry) => ({
    accession_number,
    detail_index: entry.detail_index,
    cik,
    predecessor_name: entry.predecessor_name,
    predecessor_file_number: entry.predecessor_file_number,
    predecessor_cik: entry.predecessor_cik,
    detail: details[entry.detail_index]?.acquiredDesc?.trim() || null,
    filing_date: filing_date || null,
    created_at: now,
  }));
  await repo.putBulk(rows);

  const portalRepo = new PortalRepo();
  for (const entry of resolved) {
    const predecessor = entry.predecessor_cik;
    if (predecessor === null || predecessor === cik) continue;
    const existing = await portalRepo.getPortal(predecessor);
    if (existing === undefined) continue;
    if (existing.succeeded_by_cik === cik) continue;
    await portalRepo.savePortal({ ...existing, succeeded_by_cik: cik });
  }

  return resolved;
}
