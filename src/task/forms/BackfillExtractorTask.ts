/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { Static, Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, TaskAbortedError, Workflow } from "workglow";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";
import {
  getBackfillDescriptor,
  listBackfillableExtractorIds,
  type BackfillCandidate,
} from "./backfillDescriptors";

const FALLBACK_VERSION = "1.0.0";

export interface RunExtractorBackfillOptions {
  readonly extractorId: string;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly signal?: AbortSignal;
  /** Reprocess one filing. The task wires ProcessAccessionDocFormTask; tests inject a counter. */
  readonly processFiling: (accessionNumber: string) => Promise<void>;
}

export interface ExtractorBackfillResult {
  readonly selected: number;
  readonly processed: number;
  readonly skipped: number;
}

/**
 * Generalized extractor backfill: resolve the extractor's descriptor, select
 * its candidate filings from local metadata, drop the ones that no longer need
 * work (descriptor override, else a bulk anti-join against `extractor_runs` at
 * the active version — patch-ceremony semantics included), and re-run each
 * survivor. Per-filing failures are isolated; cooperative cancellation throws
 * {@link TaskAbortedError}. `force` re-runs every candidate; `dryRun` computes
 * the counts without reprocessing.
 */
export async function runExtractorBackfill(
  opts: RunExtractorBackfillOptions
): Promise<ExtractorBackfillResult> {
  const descriptor = getBackfillDescriptor(opts.extractorId);
  if (!descriptor) {
    throw new Error(
      `No backfill wiring for extractor '${opts.extractorId}'. Backfillable: ` +
        listBackfillableExtractorIds().join(", ")
    );
  }

  const candidates = await descriptor.selectCandidates();

  let todo: BackfillCandidate[];
  if (opts.force) {
    todo = [...candidates];
  } else if (descriptor.filterTodo) {
    todo = await descriptor.filterTodo(candidates);
  } else {
    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const versionRegistry = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    const activeSlot = await getActiveSlot(versionRegistry, "extractor", opts.extractorId);
    const extractorVersion = activeSlot?.semver ?? FALLBACK_VERSION;
    todo = await runRepo.listFilingsWithoutSuccessfulRun(
      candidates,
      opts.extractorId,
      extractorVersion
    );
  }
  const skipped = candidates.length - todo.length;

  if (opts.dryRun) {
    return { selected: candidates.length, processed: 0, skipped };
  }

  let processed = 0;
  for (const c of todo) {
    if (opts.signal?.aborted) throw new TaskAbortedError();
    try {
      await opts.processFiling(c.accession_number);
      processed++;
    } catch (err) {
      // A cooperative cancellation must stop the sweep, not be swallowed as a
      // per-filing failure like a fetch/parse error.
      if (err instanceof TaskAbortedError) throw err;
      console.error(
        `backfill ${opts.extractorId}: failed to reprocess ${c.accession_number}:`,
        err
      );
    }
    if (processed % 100 === 0 && processed > 0) {
      console.log(
        `backfill ${opts.extractorId}: progress — processed=${processed}, skipped=${skipped}, total=${candidates.length}`
      );
    }
  }
  return { selected: candidates.length, processed, skipped };
}

const InputSchema = () =>
  Type.Object({
    extractorId: Type.String({ description: "Extractor id to backfill (e.g. loi, redemption)" }),
    dryRun: Type.Optional(Type.Boolean({ default: false })),
    force: Type.Optional(Type.Boolean({ default: false })),
  });
export type BackfillExtractorTaskInput = Static<ReturnType<typeof InputSchema>>;

const OutputSchema = () =>
  Type.Object({
    selected: Type.Number(),
    processed: Type.Number(),
    skipped: Type.Number(),
  });
type BackfillExtractorTaskOutput = Static<ReturnType<typeof OutputSchema>>;

/**
 * Task wrapper over {@link runExtractorBackfill} that reprocesses each filing
 * through {@link ProcessAccessionDocFormTask}, so the full form pipeline (and
 * any sub-extractors it gates) runs over filings ingested before the extractor
 * existed — the standard recovery path whenever a new extractor lands.
 */
export class BackfillExtractorTask extends Task<
  BackfillExtractorTaskInput,
  BackfillExtractorTaskOutput
> {
  static readonly type = "BackfillExtractorTask";
  static readonly category = "SEC";
  static readonly title = "Backfill extractor";
  static readonly cacheable = false;

  static inputSchema() {
    return InputSchema();
  }

  static outputSchema() {
    return OutputSchema();
  }

  async execute(
    input: BackfillExtractorTaskInput,
    context: IExecuteContext
  ): Promise<BackfillExtractorTaskOutput> {
    return runExtractorBackfill({
      extractorId: input.extractorId,
      force: input.force === true,
      dryRun: input.dryRun === true,
      signal: context.signal,
      processFiling: async (accessionNumber) => {
        const wf = context.own(new Workflow(), { title: `Backfill ${accessionNumber}` });
        wf.pipe(new ProcessAccessionDocFormTask());
        await wf.run({ accessionNumber });
      },
    });
  }
}
