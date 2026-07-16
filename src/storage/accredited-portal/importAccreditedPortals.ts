/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import type { AccreditedPortalSeedEntry } from "../../data/accreditedPortalsSeed";
import { ACCREDITED_PORTALS_SEED } from "../../data/accreditedPortalsSeed";
import { AccreditedPortalRepo } from "./AccreditedPortalRepo";
import { AccreditedPortalSignalRepo } from "./AccreditedPortalSignalRepo";
import { slugifyPortalId } from "./AccreditedPortalSchema";
import { normalizeNameSignal } from "./SignalNormalization";

/**
 * Shape accepted from an external seed file (the embarc repo's
 * data/portals-accredited.json): the embedded seed-entry shape with every
 * field but `name` optional and `live` widened, since that source stores 0/1.
 */
interface AccreditedPortalSeedInput extends Partial<
  Omit<AccreditedPortalSeedEntry, "name" | "live">
> {
  readonly name: string;
  readonly live?: number | boolean | null;
}

export interface ImportAccreditedPortalsResult {
  readonly portals: number;
  readonly signalsSeeded: number;
  readonly signalsSkippedManual: number;
}

function parseSeedFile(path: string): AccreditedPortalSeedInput[] {
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Seed file ${path} is not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Seed file ${path} must contain a JSON array of portals`);
  }
  for (const entry of parsed) {
    if (typeof entry?.name !== "string" || !entry.name.trim()) {
      throw new Error(`Seed file ${path} has an entry without a name: ${JSON.stringify(entry)}`);
    }
  }
  return parsed as AccreditedPortalSeedInput[];
}

/**
 * Bootstraps/refreshes the accredited-portal table from the embedded seed (or
 * an external JSON file in the same shape). Idempotent: portals upsert by slug
 * (preserving curated cik/notes), one seed-sourced name signal per portal is
 * refreshed, and manual signals are never touched.
 */
export async function importAccreditedPortals(
  filePath?: string
): Promise<ImportAccreditedPortalsResult> {
  const entries: readonly AccreditedPortalSeedInput[] = filePath
    ? parseSeedFile(filePath)
    : ACCREDITED_PORTALS_SEED;

  const portalRepo = new AccreditedPortalRepo();
  const signalRepo = new AccreditedPortalSignalRepo();

  let signalsSeeded = 0;
  let signalsSkippedManual = 0;

  for (const entry of entries) {
    const name = entry.name.trim();
    const portal_id = slugifyPortalId(name);
    await portalRepo.upsertFromSeed({
      portal_id,
      name,
      brand: entry.brand ?? null,
      url: entry.url ?? null,
      live: entry.live === null || entry.live === undefined ? null : Boolean(entry.live),
    });

    const nameSignal = normalizeNameSignal(name);
    if (nameSignal) {
      const wrote = await signalRepo.upsertSeedSignal({
        signal_type: "name",
        signal_value: nameSignal,
        portal_id,
        note: `seed name for ${name}`,
      });
      if (wrote) {
        signalsSeeded++;
      } else {
        signalsSkippedManual++;
      }
    }
  }

  return { portals: entries.length, signalsSeeded, signalsSkippedManual };
}
