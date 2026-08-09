/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildExtractionPrompt } from "../sec/forms/registration-statements/s1/sectionExtractors";
import { EVAL_EXTRACTORS } from "./fixtures";

export type PrintPromptsMode = "instructions" | "template" | "full";

export interface PrintPromptItem {
  readonly extractor: string;
  readonly label: string;
  readonly sectionText?: string | undefined;
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

  if (args.mode === "instructions" || args.mode === "template") {
    const seen = new Set<string>();
    for (const item of args.items) {
      if (seen.has(item.extractor)) continue;
      seen.add(item.extractor);
      const ext = EVAL_EXTRACTORS[item.extractor];
      if (!ext) throw new Error(`unknown extractor "${item.extractor}"`);
      const instructions = ext.instructions();
      const body =
        args.mode === "instructions"
          ? instructions
          : buildExtractionPrompt({ instructions, sectionText: "" });
      write(`=== ${item.extractor} / ${args.mode} ===`);
      write(body);
      write("");
    }
    return;
  }

  for (const item of args.items) {
    if (item.sectionText === undefined) {
      throw new Error(
        `full mode requires sectionText for "${item.label}" (${item.extractor})`
      );
    }
    const ext = EVAL_EXTRACTORS[item.extractor];
    if (!ext) throw new Error(`unknown extractor "${item.extractor}"`);
    const body = buildExtractionPrompt({
      instructions: ext.instructions(),
      sectionText: item.sectionText,
    });
    write(`=== ${item.extractor} / ${item.label} ===`);
    write(body);
    write("");
  }
}
