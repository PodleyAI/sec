/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildExtractionPrompt,
  isNonceEnabled,
  stripNonceSeen,
} from "../sec/forms/registration-statements/s1/sectionExtractors";
import { EVAL_EXTRACTORS } from "./fixtures";

export type PrintPromptsMode =
  | "instructions"
  | "template"
  | "document"
  | "schema"
  | "full";

export interface PrintPromptItem {
  readonly extractor: string;
  readonly label: string;
  readonly sectionText?: string | undefined;
}

/** Modes that need resolved section/fixture prose (not just extractor metadata). */
export function printPromptsNeedsSectionText(mode: PrintPromptsMode): boolean {
  return mode === "full" || mode === "document";
}

/**
 * Schema as the model would see it under the current nonce setting: the
 * canonical extractor schema when {@link isNonceEnabled}, otherwise with
 * `nonce_seen` stripped (the default / local-provider shape).
 */
export function schemaForPrint(schema: object): object {
  return isNonceEnabled() ? schema : stripNonceSeen(schema);
}

function writeSchema(write: (line: string) => void, extractor: string, schema: object): void {
  write(`=== ${extractor} / schema ===`);
  write(JSON.stringify(schemaForPrint(schema), null, 2));
  write("");
}

export function printEvalPrompts(args: {
  readonly mode: PrintPromptsMode;
  readonly items: readonly PrintPromptItem[];
  readonly write?: (line: string) => void;
}): void {
  const write = args.write ?? ((line: string) => console.log(line));
  if (args.items.length === 0) {
    throw new Error("nothing to print — no extractors/sections matched the selection");
  }

  if (args.mode === "instructions" || args.mode === "template" || args.mode === "schema") {
    const seen = new Set<string>();
    for (const item of args.items) {
      if (seen.has(item.extractor)) continue;
      seen.add(item.extractor);
      const ext = EVAL_EXTRACTORS[item.extractor];
      if (!ext) throw new Error(`unknown extractor "${item.extractor}"`);
      if (args.mode === "schema") {
        writeSchema(write, item.extractor, ext.schema());
      } else {
        const instructions = ext.instructions();
        write(`=== ${item.extractor} / ${args.mode} ===`);
        write(
          args.mode === "instructions"
            ? instructions
            : buildExtractionPrompt({ instructions, sectionText: "" })
        );
        write("");
      }
    }
    return;
  }

  if (args.mode === "document") {
    for (const item of args.items) {
      if (item.sectionText === undefined) {
        throw new Error(
          `document mode requires sectionText for "${item.label}" (${item.extractor})`
        );
      }
      if (!EVAL_EXTRACTORS[item.extractor]) {
        throw new Error(`unknown extractor "${item.extractor}"`);
      }
      write(`=== ${item.extractor} / ${item.label} ===`);
      write(item.sectionText);
      write("");
    }
    return;
  }

  const schemaWritten = new Set<string>();
  for (const item of args.items) {
    if (item.sectionText === undefined) {
      throw new Error(
        `full mode requires sectionText for "${item.label}" (${item.extractor})`
      );
    }
    const ext = EVAL_EXTRACTORS[item.extractor];
    if (!ext) throw new Error(`unknown extractor "${item.extractor}"`);
    if (!schemaWritten.has(item.extractor)) {
      schemaWritten.add(item.extractor);
      writeSchema(write, item.extractor, ext.schema());
    }
    const body = buildExtractionPrompt({
      instructions: ext.instructions(),
      sectionText: item.sectionText,
    });
    write(`=== ${item.extractor} / ${item.label} ===`);
    write(body);
    write("");
  }
}
