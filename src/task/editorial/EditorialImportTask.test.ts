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
import { EditorialImportTask } from "./EditorialImportTask";

const tempDirectories: string[] = [];

beforeEach(async () => {
  resetDependencyInjectionsForTesting();
  await setupAllDatabases();
});

afterEach(() => {
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
});
