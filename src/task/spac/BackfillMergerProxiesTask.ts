/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { Static, Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, Workflow } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SpacMergerExtractionRepo } from "../../storage/spac/SpacMergerExtractionRepo";
import { FORM_TO_EXTRACTOR_ID } from "../../storage/versioning/extractorIds";
import { ProcessAccessionDocFormTask } from "../forms/ProcessAccessionDocFormTask";

/** The 14A/14C merger + revised-proxy forms routed to the `merger-proxy` extractor. */
const MERGER_PROXY_FORMS = Object.entries(FORM_TO_EXTRACTOR_ID)
  .filter(([, id]) => id === "merger-proxy")
  .map(([form]) => form);

/**
 * Accession numbers of known-SPAC merger proxies that have no extraction row
 * yet, enumerated from the bootstrapped `filing` metadata (no network discovery).
 *
 * `processMergerProxy` gates on a known SPAC and silently no-ops (recording a
 * `success: true` run) when the `spac` row does not yet exist — e.g. a proxy
 * ingested before its S-1. Those filings are then excluded from the normal
 * unprocessed-run sweep forever, so the merger target / PIPE is dropped. This
 * recovers them once a `spac` row appears. Filings that already produced a
 * `spac_merger_extraction` row are skipped to avoid redundant AI re-runs.
 */
export async function selectMergerProxyBackfillAccessions(): Promise<string[]> {
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const spacRepo = new SpacRepo();
  const extractions = new SpacMergerExtractionRepo();
  const out: string[] = [];
  const spacs = await spacRepo.getAllSpacs();
  for (const spac of spacs) {
    // Query by (form, cik) — the filings storage is indexed on ["form", "cik"],
    // so this loads only the SPAC's proxies instead of scanning all its filings.
    for (const form of MERGER_PROXY_FORMS) {
      const filings = (await filingRepo.query({ form, cik: spac.cik })) ?? [];
      for (const f of filings) {
        const already = await extractions.getByAccession(f.accession_number);
        if (!already) out.push(f.accession_number);
      }
    }
  }
  return out;
}

const InputSchema = () =>
  Type.Object({
    dryRun: Type.Optional(Type.Boolean({ default: false })),
  });
export type BackfillMergerProxiesTaskInput = Static<ReturnType<typeof InputSchema>>;

const OutputSchema = () =>
  Type.Object({
    selected: Type.Number(),
    processed: Type.Number(),
  });
type BackfillMergerProxiesTaskOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Sweeps historical known-SPAC merger proxies that were never extracted (because
 * the SPAC was not yet known at ingestion) and re-runs
 * {@link ProcessAccessionDocFormTask} for each so the merger-proxy extractor
 * runs now that a `spac` row exists.
 */
export class BackfillMergerProxiesTask extends Task<
  BackfillMergerProxiesTaskInput,
  BackfillMergerProxiesTaskOutput
> {
  static readonly type = "BackfillMergerProxiesTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: BackfillMergerProxiesTaskInput,
    context: IExecuteContext
  ): Promise<BackfillMergerProxiesTaskOutput> {
    const accessions = await selectMergerProxyBackfillAccessions();
    if (input.dryRun) {
      return { selected: accessions.length, processed: 0 };
    }
    // Isolate per-filing failures: one bad proxy (fetch error, malformed body)
    // must not abort the sweep over the remaining accessions.
    let processed = 0;
    for (const accessionNumber of accessions) {
      try {
        const wf = context.own(new Workflow());
        wf.pipe(new ProcessAccessionDocFormTask());
        await wf.run({ accessionNumber });
        processed++;
      } catch (err) {
        console.error(`backfill-merger-proxies: failed to reprocess ${accessionNumber}:`, err);
      }
    }
    return { selected: accessions.length, processed };
  }
}
