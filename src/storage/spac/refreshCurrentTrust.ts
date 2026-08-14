/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../facts/CompanyFactsSchema";
import { isNewerTrustSnapshot, pickLatestTrustFact } from "./pickLatestTrustFact";
import { SpacRepo } from "./SpacRepo";
import { SpacReportWriter } from "./SpacReportWriter";

interface TrustSnapshot {
  readonly amount: number;
  readonly asOf: string;
  readonly filed: string;
}

async function latestTrustSnapshot(cik: number): Promise<TrustSnapshot | null> {
  const factsRepo = globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN);
  const facts = (await factsRepo.query({ cik })) ?? [];
  const picked = pickLatestTrustFact(facts);
  if (picked == null || picked.end_date == null) return null;
  return { amount: picked.val, asOf: picked.end_date, filed: picked.filed_date };
}

/** True when a facts snapshot exists that would change the spac row. */
export async function wouldRefreshCurrentTrust(cik: number): Promise<boolean> {
  const existing = await new SpacRepo().getSpac(cik);
  if (existing == null) return false;
  const snap = await latestTrustSnapshot(cik);
  if (snap == null) return false;
  return isNewerTrustSnapshot(snap, {
    asOf: existing.current_trust_as_of,
    filed: existing.current_trust_filed,
  });
}

/**
 * If `cik` is a known SPAC, lift the latest 10-Q/10-K AssetsHeldInTrust fact
 * onto `current_trust_*`. Returns whether the row changed. Never mints a spac
 * row; a missing or unusable fact is a no-op.
 */
export async function refreshCurrentTrustFromFacts(cik: number): Promise<boolean> {
  const existing = await new SpacRepo().getSpac(cik);
  if (existing == null) return false;
  const snap = await latestTrustSnapshot(cik);
  if (snap == null) return false;
  return await new SpacReportWriter().recordCurrentTrust({
    cik,
    amount: snap.amount,
    asOf: snap.asOf,
    filed: snap.filed,
  });
}
