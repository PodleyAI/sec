/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import {
  clearFamilyEditorialImporterForTesting,
  clearSpacEditorialImporterForTesting,
  registerSpacEditorialImporter,
} from "../../commands/editorialImport";
import { EditorialImportTask } from "./EditorialImportTask";

const tempDirectories: string[] = [];

beforeEach(async () => {
  resetDependencyInjectionsForTesting();
  await setupAllDatabases();
});

afterEach(() => {
  clearSpacEditorialImporterForTesting();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("EditorialImportTask", () => {
  it("reports a failed file without losing other file results", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sec-editorial-import-"));
    tempDirectories.push(directory);
    const first = join(directory, "first.csv");
    const invalid = join(directory, "invalid.csv");
    const third = join(directory, "third.csv");
    const validCsv =
      "family_kind,name,description\n" +
      "underwriter-family,Chardan,SPAC-focused investment bank.\n";
    writeFileSync(first, validCsv);
    writeFileSync(invalid, 'family_kind,name,description\n"unterminated');
    writeFileSync(third, validCsv);

    const { results } = await new EditorialImportTask({
      defaults: {
        files: [first, invalid, third],
        createMissing: false,
        dryRun: true,
      },
    }).run();

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ file: first, written: 1, importError: null });
    expect(results[1]).toEqual(
      expect.objectContaining({
        file: invalid,
        kind: "failed",
        importError: expect.any(String),
      })
    );
    expect(results[2]).toMatchObject({ file: third, written: 1, importError: null });
  });

  /**
   * The rows a spac editorial CSV names live in a lifecycle model shipped
   * elsewhere, so the parse is here and the write is contributed. Reporting
   * `written` for rows nobody stored is the failure worth refusing over — it
   * looks exactly like a successful import.
   */
  it("refuses the spac half of the format when no writer is registered", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sec-editorial-import-"));
    tempDirectories.push(directory);
    const file = join(directory, "spac.csv");
    writeFileSync(
      file,
      "cik,name,url_spac,url_sponsor,details\n10,Known,,https://a.example.com,\n"
    );

    const { results } = await new EditorialImportTask({
      defaults: { files: [file], createMissing: false, dryRun: false },
    }).run();

    expect(results[0]).toEqual(
      expect.objectContaining({ kind: "failed", written: 0, importError: expect.any(String) })
    );
    expect(results[0].importError).toMatch(/registers no writer for spac editorial rows/);
  });

  it("hands those rows to a registered writer, with the flags the caller passed", async () => {
    const seen: Array<{ ciks: number[]; createMissing: boolean; dryRun: boolean }> = [];
    registerSpacEditorialImporter(async (rows, opts) => {
      seen.push({
        ciks: rows.map((r) => r.cik),
        createMissing: opts.createMissing,
        dryRun: opts.dryRun,
      });
      return { written: rows.length, created: 1, skippedMissing: [] };
    });

    const directory = mkdtempSync(join(tmpdir(), "sec-editorial-import-"));
    tempDirectories.push(directory);
    const file = join(directory, "spac.csv");
    writeFileSync(
      file,
      "cik,name,url_spac,url_sponsor,details\n10,Known,,https://a.example.com,\n"
    );

    const { results } = await new EditorialImportTask({
      defaults: { files: [file], createMissing: true, dryRun: true },
    }).run();

    expect(seen).toEqual([{ ciks: [10], createMissing: true, dryRun: true }]);
    expect(results[0]).toMatchObject({ kind: "spac", written: 1, created: 1, importError: null });
  });

  /**
   * The family half is contributed the same way the spac half is, and the
   * families it names are a tier that need not ship here either. Refusing by
   * name is the point: a caller told `written: 1` for a row nobody stored has
   * been told something false, and it looks exactly like a successful import.
   */
  it("refuses the family half of the format when no writer is registered", async () => {
    clearFamilyEditorialImporterForTesting();
    const directory = mkdtempSync(join(tmpdir(), "sec-editorial-import-"));
    tempDirectories.push(directory);
    const file = join(directory, "family.csv");
    writeFileSync(
      file,
      "family_kind,name,description\nunderwriter-family,Chardan,SPAC-focused investment bank.\n"
    );

    const { results } = await new EditorialImportTask({
      defaults: { files: [file], createMissing: false, dryRun: true },
    }).run();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ file, kind: "family", written: 0 });
    expect(results[0]!.importError).toMatch(/no writer for family description rows/);
  });
});
