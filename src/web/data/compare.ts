/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getGlobalModelRepository, type ModelConfig } from "workglow";
import { estimateExtractionPromptChars, EVAL_EXTRACTORS } from "../../eval/fixtures";
import { estimateCost } from "../../eval/modelPricing";
import { EXTRACTOR_TO_SECTION } from "../../eval/realSections";
import { scoreExtraction, type ExtractionScore } from "../../eval/scoreExtraction";
import { registerModelIds } from "../../config/registerModels";
import { prefetchModel } from "../../task/model/EnsureModelDownloadedTask";
import { loadFilingDocument } from "./documents";

/** One model's attempt at one section. */
export interface CompareRun {
  readonly model: string;
  readonly ok: boolean;
  readonly error: string;
  readonly latencyMs: number;
  readonly rows: readonly unknown[];
  /** Estimated USD for this call — char-approximated, so a ranking not a bill. */
  readonly usd: number | null;
  /**
   * Agreement with the FIRST model in the list, which stands in as the
   * reference. Undefined for the reference itself, and for a run that failed.
   */
  readonly agreement: ExtractionScore | undefined;
}

/** A head-to-head over one filing's section. */
export interface CompareResult {
  readonly cik: number;
  readonly accessionNumber: string;
  readonly extractor: string;
  readonly sectionName: string;
  readonly sectionChars: number;
  readonly sectionText: string;
  readonly runs: readonly CompareRun[];
  readonly error: string;
}

/** Extractors the comparison can drive, i.e. those mapped to a segmenter section. */
export function comparableExtractors(): readonly string[] {
  return Object.keys(EXTRACTOR_TO_SECTION)
    .filter((name) => EVAL_EXTRACTORS[name] !== undefined)
    .sort();
}

/**
 * Run one filing's section through several models and score them against each
 * other.
 *
 * This deliberately does NOT persist anything. The question it answers is
 * "would a different model read this section better", and answering it by
 * writing rows would mean a comparison silently replaced the extraction whose
 * correctness is under review. Adopting a model is a separate, explicit act:
 * pick it in the process page's model picker and re-run the filing.
 *
 * The first model doubles as the reference, so the agreement column reads "how
 * far does this model diverge from the one I trust". That is a comparison, not
 * a verdict — `sec eval s1 --reference golden` is what scores a model against
 * human-verified truth.
 */
export async function compareModels(args: {
  readonly cik: number;
  readonly accessionNumber: string;
  readonly extractor: string;
  readonly models: readonly string[];
}): Promise<CompareResult> {
  const extractor = EVAL_EXTRACTORS[args.extractor];
  const sectionName = EXTRACTOR_TO_SECTION[args.extractor];
  const empty = {
    cik: args.cik,
    accessionNumber: args.accessionNumber,
    extractor: args.extractor,
    sectionName: sectionName ?? "",
    sectionChars: 0,
    sectionText: "",
    runs: [] as readonly CompareRun[],
  };
  if (extractor === undefined || sectionName === undefined) {
    return { ...empty, error: `unknown extractor "${args.extractor}"` };
  }
  if (args.models.length === 0) {
    return { ...empty, error: "no models selected" };
  }

  const doc = await loadFilingDocument({
    cik: args.cik,
    accessionNumber: args.accessionNumber,
    includeText: true,
  });
  if (doc.error !== "") return { ...empty, error: doc.error };
  const section = doc.sections.find((s) => s.name === sectionName);
  if (section === undefined || section.text.trim() === "") {
    return {
      ...empty,
      error: `the segmenter found no "${sectionName}" section in this filing`,
    };
  }
  const text = extractor.prepareSectionText
    ? extractor.prepareSectionText(section.text)
    : section.text;

  await registerModelIds(args.models);
  const repo = getGlobalModelRepository();
  const promptChars = estimateExtractionPromptChars(extractor.instructions(), text);

  const runs: CompareRun[] = [];
  let reference: readonly unknown[] | undefined;
  for (const modelId of args.models) {
    const model = (await repo.findByName(modelId)) as ModelConfig | undefined;
    if (model === undefined) {
      runs.push({
        model: modelId,
        ok: false,
        error: `model "${modelId}" is not registered`,
        latencyMs: 0,
        rows: [],
        usd: null,
        agreement: undefined,
      });
      continue;
    }
    // Local weights are fetched before the timed call so a first-use download
    // is not charged to the model's measured latency.
    await prefetchModel(modelId, undefined);
    const startedAt = Date.now();
    try {
      const rows = await extractor.run(text, model);
      const latencyMs = Date.now() - startedAt;
      const outputChars = JSON.stringify(rows).length;
      runs.push({
        model: modelId,
        ok: true,
        error: "",
        latencyMs,
        rows,
        usd: estimateCost(modelId, promptChars, outputChars).usd,
        agreement:
          reference === undefined
            ? undefined
            : scoreExtraction(rows, reference as readonly Record<string, unknown>[], {
                keyField: extractor.keyField,
                fields: extractor.compareFields,
                personNameFields: extractor.personNameFields,
                companyNameFields: extractor.companyNameFields,
                entityNameFields: extractor.entityNameFields,
                entityKindField: extractor.entityKindField,
              }),
      });
      if (reference === undefined) reference = rows;
    } catch (e) {
      runs.push({
        model: modelId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - startedAt,
        rows: [],
        usd: null,
        agreement: undefined,
      });
    }
  }

  return {
    ...empty,
    sectionChars: section.text.length,
    sectionText: text,
    runs,
    error: "",
  };
}
