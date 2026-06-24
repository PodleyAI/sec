/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { Static, Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, Workflow } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { hasRedemptionTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import { ProcessAccessionDocFormTask } from "../forms/ProcessAccessionDocFormTask";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";

const REDEMPTION_EXTRACTOR_ID = "redemption";
const DEFAULT_REDEMPTION_VERSION = "1.0.0";

export interface RedemptionBackfillCandidate {
  readonly cik: number;
  readonly accession_number: string;
}

/**
 * Candidate known-SPAC 8-Ks (and 8-K/A) carrying a redemption-trigger item.
 * Loads the full 8-K / 8-K/A sets in two bulk queries (the codebase pattern
 * matches `UpdateAllFormsTask`), then filters in memory against the SPAC CIK
 * set — cheaper than `2 × NUM_SPACS` `(form, cik)` queries when the SPAC count
 * grows.
 */
export async function selectRedemptionBackfillCandidates(): Promise<RedemptionBackfillCandidate[]> {
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const spacRepo = new SpacRepo();
  const spacs = await spacRepo.getAllSpacs();
  const spacCiks = new Set(spacs.map((s) => s.cik));
  const out: RedemptionBackfillCandidate[] = [];
  for (const form of ["8-K", "8-K/A"]) {
    const filings = (await filingRepo.query({ form })) ?? [];
    for (const f of filings) {
      if (!spacCiks.has(f.cik)) continue;
      if (hasRedemptionTriggerItem(f.items)) {
        out.push({ cik: f.cik, accession_number: f.accession_number });
      }
    }
  }
  return out;
}

/**
 * Backwards-compatible thin wrapper around
 * {@link selectRedemptionBackfillCandidates} that returns accession numbers
 * only. New call sites should prefer the candidate form so the (cik,
 * accession) pair can be used directly for `extractor_runs` lookups.
 */
export async function selectRedemptionBackfillAccessions(): Promise<string[]> {
  return (await selectRedemptionBackfillCandidates()).map((c) => c.accession_number);
}

const InputSchema = () =>
  Type.Object({
    dryRun: Type.Optional(Type.Boolean({ default: false })),
    force: Type.Optional(Type.Boolean({ default: false })),
  });
export type BackfillRedemptionsTaskInput = Static<ReturnType<typeof InputSchema>>;

const OutputSchema = () =>
  Type.Object({
    selected: Type.Number(),
    processed: Type.Number(),
    skipped: Type.Number(),
  });
type BackfillRedemptionsTaskOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Sweeps historical known-SPAC trigger-item 8-Ks and re-runs
 * {@link ProcessAccessionDocFormTask} for each so the redemption extractor
 * (which now escalates to the full submission and extracts) runs over filings
 * that were processed before it existed. Idempotent: a left-anti-join against
 * `extractor_runs` skips filings already successfully extracted at the active
 * redemption version. Pass `force: true` to re-run regardless. Honors
 * `context.signal` for cancellation; emits a progress log every 100 processed.
 */
export class BackfillRedemptionsTask extends Task<
  BackfillRedemptionsTaskInput,
  BackfillRedemptionsTaskOutput
> {
  static readonly type = "BackfillRedemptionsTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: BackfillRedemptionsTaskInput,
    context: IExecuteContext
  ): Promise<BackfillRedemptionsTaskOutput> {
    const candidates = await selectRedemptionBackfillCandidates();
    if (input.dryRun) {
      return { selected: candidates.length, processed: 0, skipped: 0 };
    }

    const runRepo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );
    const versionRegistry = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    const activeSlot = await getActiveSlot(
      versionRegistry,
      "extractor",
      REDEMPTION_EXTRACTOR_ID
    );
    const extractorVersion = activeSlot?.semver ?? DEFAULT_REDEMPTION_VERSION;

    const signal = (context as unknown as { signal?: AbortSignal }).signal;

    // Isolate per-filing failures: one bad 8-K (fetch error, malformed body)
    // must not abort the sweep over the remaining candidates.
    let processed = 0;
    let skipped = 0;
    for (const c of candidates) {
      if (signal?.aborted) break;
      if (!input.force) {
        const already = await runRepo.hasSuccessfulRun(
          c.cik,
          c.accession_number,
          REDEMPTION_EXTRACTOR_ID,
          extractorVersion
        );
        if (already) {
          skipped++;
          continue;
        }
      }
      try {
        const wf = context.own(new Workflow());
        wf.pipe(new ProcessAccessionDocFormTask());
        await wf.run({ accessionNumber: c.accession_number });
        processed++;
      } catch (err) {
        console.error(
          `backfill-redemptions: failed to reprocess ${c.accession_number}:`,
          err
        );
      }
      if ((processed + skipped) % 100 === 0 && processed + skipped > 0) {
        console.log(
          `backfill-redemptions: progress — processed=${processed}, skipped=${skipped}, total=${candidates.length}`
        );
      }
    }
    return { selected: candidates.length, processed, skipped };
  }
}
