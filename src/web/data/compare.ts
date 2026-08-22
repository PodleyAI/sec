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
import { schemaForPrint } from "../../eval/printEvalPrompts";
import {
  buildExtractionPrompt,
  isNonceEnabled,
} from "../../sec/forms/registration-statements/s1/sectionExtractors";
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
  /** The section prose after {@link EvalExtractor.prepareSectionText}, as fenced into the prompt. */
  readonly sectionText: string;
  /**
   * The complete prompt each model receives — injection-hardening preamble,
   * the extractor's instructions, and the section fenced as untrusted filer
   * text — built through the production `buildExtractionPrompt`, not a
   * reconstruction. The section alone does not explain a model's answer; the
   * instructions around it are most of what decides it.
   */
  readonly prompt: string;
  /** The instructions block on its own — the part you would actually edit. */
  readonly instructions: string;
  /** The output schema as the model sees it under the current nonce setting. */
  readonly schema: string;
  /**
   * True when `SEC_EXTRACTION_NONCE` is on, in which case a cloud provider's
   * real prompt carries a per-attempt verification token this preview omits
   * (it differs every attempt, so no single rendering is the prompt).
   */
  readonly nonceEnabled: boolean;
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
  /**
   * Resolve the section and build the prompt, but call no model. Inspecting
   * what a model is about to be asked is the cheapest step in the loop and
   * should not cost an API call to reach.
   */
  readonly previewOnly?: boolean | undefined;
  /**
   * Called as each stage completes. A cloud model over a 40k-char section takes
   * tens of seconds and they run one at a time, so a caller with a live surface
   * has something to say for most of a comparison's duration.
   */
  readonly onProgress?: ((message: string) => void) | undefined;
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
    prompt: "",
    instructions: "",
    schema: "",
    nonceEnabled: isNonceEnabled(),
    runs: [] as readonly CompareRun[],
  };
  if (extractor === undefined || sectionName === undefined) {
    return { ...empty, error: `unknown extractor "${args.extractor}"` };
  }
  if (args.models.length === 0 && args.previewOnly !== true) {
    return { ...empty, error: "no models selected" };
  }

  const report = args.onProgress ?? ((): void => {});
  report(`converting and segmenting ${args.accessionNumber}`);
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
  const instructions = extractor.instructions();
  // Built through the production builder rather than reassembled here: a
  // preview that composes its own preamble is a second implementation of the
  // prompt, and the first thing it would do is drift from the real one.
  const prompt = buildExtractionPrompt({ instructions, sectionText: text });
  const shown = {
    ...empty,
    sectionChars: section.text.length,
    sectionText: text,
    prompt,
    instructions,
    schema: JSON.stringify(schemaForPrint(extractor.schema()), null, 2),
  };
  if (args.previewOnly === true) return { ...shown, error: "" };

  report(
    `section "${sectionName}" resolved — ${section.text.length.toLocaleString()} chars, ` +
      `prompt ${prompt.length.toLocaleString()} chars`
  );
  await registerModelIds(args.models);
  const repo = getGlobalModelRepository();
  const promptChars = estimateExtractionPromptChars(instructions, text);

  const runs: CompareRun[] = [];
  let reference: readonly unknown[] | undefined;
  for (const [index, modelId] of args.models.entries()) {
    report(`[${index + 1}/${args.models.length}] ${modelId} — running`);
    const model = (await repo.findByName(modelId)) as ModelConfig | undefined;
    if (model === undefined) {
      report(`[${index + 1}/${args.models.length}] ${modelId} — not registered`);
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
      report(
        `[${index + 1}/${args.models.length}] ${modelId} — ok, ${rows.length} row(s) in ` +
          `${(latencyMs / 1000).toFixed(1)}s`
      );
    } catch (e) {
      report(
        `[${index + 1}/${args.models.length}] ${modelId} — failed: ` +
          `${e instanceof Error ? e.message : String(e)}`
      );
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

  return { ...shown, runs, error: "" };
}

/** One model's answer for one aligned row. */
export interface CompareCell {
  readonly model: string;
  /** False when this model produced no row for the key — the interesting case. */
  readonly present: boolean;
  /** The compared fields, in `fields` order, formatted for a table cell. */
  readonly values: readonly string[];
}

export interface CompareTableRow {
  readonly key: string;
  readonly cells: readonly CompareCell[];
  /** True when every model answered for this key and they all agree. */
  readonly agree: boolean;
}

/** Model answers aligned side by side, which is the shape a comparison is read in. */
export interface CompareTable {
  /** The field rows are aligned on, or undefined for a positional extractor. */
  readonly keyField: string | undefined;
  readonly fields: readonly string[];
  readonly models: readonly string[];
  readonly rows: readonly CompareTableRow[];
  /** Rows where the models did not all produce the same values. */
  readonly disagreements: number;
}

/** Provenance the models are not compared on; noise in a comparison table. */
const NON_COMPARED_FIELDS: ReadonlySet<string> = new Set([
  "source_span",
  "confidence",
  "nonce_seen",
]);

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Align every model's rows into one table, keyed the way the extractor keys them.
 *
 * Reading four JSON dumps side by side and diffing them by eye is what the
 * comparison asked of its reader, and it is exactly what a table does better:
 * one row per entity, one column per model, so a model that DROPPED an entity
 * shows as a gap rather than as an absence you have to notice.
 *
 * Alignment mirrors `scoreExtraction`: on the extractor's `keyField` where it
 * declares one, positionally where it does not (a single-object extractor, or
 * an order-stable list like a compensation table).
 */
export function buildCompareTable(result: CompareResult): CompareTable {
  const extractor = EVAL_EXTRACTORS[result.extractor];
  const keyField = extractor?.keyField;
  const ok = result.runs.filter((r) => r.ok);
  const models = ok.map((r) => r.model);

  // Field order comes from the extractor's own `compareFields` where it has
  // them — the fields it is scored on — and otherwise from the rows' own keys,
  // minus provenance.
  const fields: string[] =
    extractor?.compareFields !== undefined
      ? [...extractor.compareFields]
      : [
          ...new Set(
            ok
              .flatMap((r) => r.rows)
              .flatMap((row) => Object.keys((row ?? {}) as Record<string, unknown>))
          ),
        ].filter((f) => !NON_COMPARED_FIELDS.has(f));

  const keyOf = (row: unknown, index: number): string =>
    keyField === undefined
      ? `#${index + 1}`
      : formatValue((row as Record<string, unknown> | null)?.[keyField]) || `#${index + 1}`;

  // Insertion order across models, reference first, so the table reads in the
  // order the model you trust produced.
  const order: string[] = [];
  const byModel = new Map<string, Map<string, unknown>>();
  for (const run of ok) {
    const rows = new Map<string, unknown>();
    run.rows.forEach((row, index) => {
      const key = keyOf(row, index);
      if (!rows.has(key)) rows.set(key, row);
      if (!order.includes(key)) order.push(key);
    });
    byModel.set(run.model, rows);
  }

  let disagreements = 0;
  const rows: CompareTableRow[] = order.map((key) => {
    const cells: CompareCell[] = models.map((model) => {
      const row = byModel.get(model)?.get(key);
      return {
        model,
        present: row !== undefined,
        values:
          row === undefined
            ? fields.map(() => "")
            : fields.map((f) => formatValue((row as Record<string, unknown>)[f])),
      };
    });
    const first = JSON.stringify(cells[0]?.values ?? []);
    const agree =
      cells.every((c) => c.present) && cells.every((c) => JSON.stringify(c.values) === first);
    if (!agree) disagreements += 1;
    return { key, cells, agree };
  });

  return { keyField, fields, models, rows, disagreements };
}
