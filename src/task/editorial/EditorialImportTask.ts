/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "fs";
import { Type } from "typebox";
import { Task } from "workglow";
import {
  importFamilyDescriptions,
  importSpacEditorial,
  parseEditorialCsv,
} from "../../commands/editorialImport";

export type EditorialImportTaskInput = {
  readonly files: string[];
  readonly createMissing: boolean;
  readonly dryRun: boolean;
};

export type EditorialImportFileResult = {
  readonly file: string;
  readonly kind: "spac" | "family" | "unreadable" | "failed";
  readonly written: number;
  readonly created: number;
  readonly skippedMissing: number;
  /** Line-numbered CSV validation errors (empty when the file parsed clean). */
  readonly errors: string[];
  /** Set when the file could not be read; no import was attempted. */
  readonly readError: string | null;
  /** Set when parsing or importing failed; earlier files remain reportable. */
  readonly importError: string | null;
};

export type EditorialImportTaskOutput = {
  readonly results: EditorialImportFileResult[];
};

/**
 * Imports editorial CSV file(s) — spac-row editorial fields or family
 * descriptions, detected by header. An unreadable file yields a result entry
 * with `readError` set rather than aborting the sweep over the remaining files.
 */
export class EditorialImportTask extends Task<EditorialImportTaskInput, EditorialImportTaskOutput> {
  static readonly type = "EditorialImportTask";
  static readonly category = "SEC";
  static readonly title = "Import editorial CSV(s)";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      files: Type.Array(Type.String()),
      createMissing: Type.Boolean(),
      dryRun: Type.Boolean(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      results: Type.Array(Type.Unknown()),
    });
  }

  async execute(input: EditorialImportTaskInput): Promise<EditorialImportTaskOutput> {
    const results: EditorialImportFileResult[] = [];
    for (const file of input.files) {
      let content: string;
      try {
        content = readFileSync(file, "utf8");
      } catch (err) {
        results.push({
          file,
          kind: "unreadable",
          written: 0,
          created: 0,
          skippedMissing: 0,
          errors: [],
          readError: `cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`,
          importError: null,
        });
        continue;
      }
      try {
        const parsed = parseEditorialCsv(content);
        if (parsed.kind === "family") {
          const res = await importFamilyDescriptions(parsed.familyRows, { dryRun: input.dryRun });
          results.push({
            file,
            kind: "family",
            written: res.written,
            created: 0,
            skippedMissing: 0,
            errors: [...parsed.errors],
            readError: null,
            importError: null,
          });
          continue;
        }
        const res = await importSpacEditorial(parsed.spacRows, {
          createMissing: input.createMissing,
          dryRun: input.dryRun,
        });
        results.push({
          file,
          kind: "spac",
          written: res.written,
          created: res.created,
          skippedMissing: res.skippedMissing.length,
          errors: [...parsed.errors],
          readError: null,
          importError: null,
        });
      } catch (err) {
        results.push({
          file,
          kind: "failed",
          written: 0,
          created: 0,
          skippedMissing: 0,
          errors: [],
          readError: null,
          importError:
            `failed importing ${file}; partial writes may have occurred: ` +
            (err instanceof Error ? err.message : String(err)),
        });
      }
    }
    return { results };
  }
}
