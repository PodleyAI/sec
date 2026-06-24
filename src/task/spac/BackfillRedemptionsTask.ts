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

/**
 * Accession numbers of known-SPAC 8-Ks carrying a redemption-trigger item,
 * enumerated from the bootstrapped `filing` metadata (no network discovery).
 */
export async function selectRedemptionBackfillAccessions(): Promise<string[]> {
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const spacRepo = new SpacRepo();
  const out: string[] = [];
  const spacs = await spacRepo.getAllSpacs();
  for (const spac of spacs) {
    // Query by (form, cik) — the filings storage is indexed on ["form", "cik"],
    // so this loads only the SPAC's 8-Ks instead of scanning all its filings.
    for (const form of ["8-K", "8-K/A"]) {
      const filings = (await filingRepo.query({ form, cik: spac.cik })) ?? [];
      for (const f of filings) {
        if (hasRedemptionTriggerItem(f.items)) {
          out.push(f.accession_number);
        }
      }
    }
  }
  return out;
}

const InputSchema = () =>
  Type.Object({
    dryRun: Type.Optional(Type.Boolean({ default: false })),
  });
export type BackfillRedemptionsTaskInput = Static<ReturnType<typeof InputSchema>>;

const OutputSchema = () =>
  Type.Object({
    selected: Type.Number(),
    processed: Type.Number(),
  });
type BackfillRedemptionsTaskOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Sweeps historical known-SPAC trigger-item 8-Ks and re-runs
 * {@link ProcessAccessionDocFormTask} for each so the redemption extractor
 * (which now escalates to the full submission and extracts) runs over filings
 * that were processed before it existed.
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
    const accessions = await selectRedemptionBackfillAccessions();
    if (input.dryRun) {
      return { selected: accessions.length, processed: 0 };
    }
    // Isolate per-filing failures: one bad 8-K (fetch error, malformed body)
    // must not abort the sweep over the remaining accessions.
    let processed = 0;
    for (const accessionNumber of accessions) {
      try {
        const wf = context.own(new Workflow());
        wf.pipe(new ProcessAccessionDocFormTask());
        await wf.run({ accessionNumber });
        processed++;
      } catch (err) {
        console.error(`backfill-redemptions: failed to reprocess ${accessionNumber}:`, err);
      }
    }
    return { selected: accessions.length, processed };
  }
}
