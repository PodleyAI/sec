/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import type { ExtractionDeadLetter } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import type { ExtractorRun } from "../../storage/versioning/ExtractorRunSchema";
import { formToExtractorId } from "../../storage/versioning/extractorIds";
import { planSpacTimeline } from "../../task/spac/planSpacTimeline";
import type { SpacProcessForce } from "../../task/spac/parseSpacProcessForce";
import { loadFilingDocument, type FilingDocument } from "./documents";

/**
 * What a step's last recorded run says about it. `pending` is the state a step
 * has never been run in; `stale` is one whose newest run is at a version other
 * than the active one, which reads as work to do rather than as a failure.
 */
export type StepState = "pending" | "success" | "partial" | "failure" | "stale";

/** One filing on the issuer's timeline — the unit `spac process` replays. */
export interface TimelineStep {
  readonly index: number;
  readonly cik: number;
  readonly accessionNumber: string;
  readonly form: string;
  readonly filingDate: string | null;
  readonly items: string | null;
  readonly extractorId: string | undefined;
  readonly activeVersion: string | undefined;
  readonly latestRun: ExtractorRun | undefined;
  readonly state: StepState;
  /** True when a plain (unforced) replay would send this filing to the processor. */
  readonly selected: boolean;
  readonly pendingDeadLetters: readonly ExtractionDeadLetter[];
  /** Cache status only — the body is not converted here (see {@link loadFilingDocument}). */
  readonly document: FilingDocument;
}

/** The whole checklist for one issuer. */
export interface TimelineSteps {
  readonly cik: number;
  readonly steps: readonly TimelineStep[];
  readonly hasSpacRow: boolean;
  readonly firstDate: string;
  readonly lastDate: string;
  /** Steps a plain replay would run — what the "Run outstanding" button covers. */
  readonly outstanding: number;
}

const NO_FORCE: SpacProcessForce = { kind: "none" };

function stateOf(run: ExtractorRun | undefined, activeVersion: string | undefined): StepState {
  if (run === undefined) return "pending";
  if (activeVersion !== undefined && run.extractor_version !== activeVersion) return "stale";
  return run.outcome;
}

/**
 * Build the per-filing checklist the process page renders.
 *
 * Selection comes from {@link planSpacTimeline}, the same function
 * `ProcessSpacTimelineTask` replays, so "what this page says is outstanding" and
 * "what pressing Run would actually process" cannot disagree.
 */
export async function loadTimelineSteps(cik: number): Promise<TimelineSteps> {
  const plan = await planSpacTimeline({ cik, force: NO_FORCE });
  const selected = new Set(plan.toProcess.map((f) => f.accession_number));
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  const deadLetterRepo = globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN);

  const steps: TimelineStep[] = [];
  for (const [index, filing] of plan.timeline.entries()) {
    const form = filing.form ?? "";
    const extractorId = form === "" ? undefined : formToExtractorId(form);
    const activeVersion =
      extractorId === undefined ? undefined : plan.activeVersions.get(extractorId);
    const latestRun =
      extractorId === undefined
        ? undefined
        : await runRepo.findLatestRun(cik, filing.accession_number, extractorId);
    const pending = ((await deadLetterRepo.query({
      accession_number: filing.accession_number,
      status: "pending",
    })) ?? []) as ExtractionDeadLetter[];
    steps.push({
      index,
      cik,
      accessionNumber: filing.accession_number,
      form,
      filingDate: filing.filing_date ?? null,
      items: filing.items ?? null,
      extractorId,
      activeVersion,
      latestRun,
      state: stateOf(latestRun, activeVersion),
      selected: selected.has(filing.accession_number),
      pendingDeadLetters: pending,
      document: await loadFilingDocument({ cik, accessionNumber: filing.accession_number }),
    });
  }

  return {
    cik,
    steps,
    hasSpacRow: plan.hasSpacRow,
    firstDate: plan.firstDate,
    lastDate: plan.lastDate,
    outstanding: plan.toProcess.length,
  };
}
