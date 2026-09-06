/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { resetSecKnowledgeBaseForTesting } from "../../kb/secKnowledgeBase";
import {
  FILING_DOCUMENT_REPOSITORY_TOKEN,
  type FilingDocument,
} from "../../storage/document/FilingDocumentSchema";
import { FILING_SECTION_REPOSITORY_TOKEN } from "../../storage/document/FilingSectionSchema";
import { IndexFilingSectionsTask } from "./IndexFilingSectionsTask";

const header = (index: number, filingDate: string): FilingDocument => ({
  cik: 320193,
  accession_number: `0000320193-26-${String(index).padStart(6, "0")}`,
  doc_file: "primary.htm",
  doc_type: "10-K",
  description: null,
  sequence: 1,
  is_primary: true,
  form: "10-K",
  filing_date: filingDate,
  title: `Filing ${index}`,
  section_count: 1,
  char_count: 100,
  converter_version: "1",
  converted_at: "2026-01-01T00:00:00.000Z",
});

/**
 * Embedding is the expensive half, and a `limit` of 0 is what lets these cases
 * exercise the selection — how filings are read, and when the run stops —
 * without loading a model to embed one.
 */
describe("IndexFilingSectionsTask selection", () => {
  withSqliteDb("kb_index_selection", [
    FILING_DOCUMENT_REPOSITORY_TOKEN,
    FILING_SECTION_REPOSITORY_TOKEN,
  ]);

  afterEach(async () => {
    await resetSecKnowledgeBaseForTesting();
  });

  const seed = async (count: number, filingDate = "2026-01-02"): Promise<void> => {
    const repo = globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN);
    for (let index = 0; index < count; index += 1) {
      await repo.put(header(index, filingDate));
    }
  };

  it("streams the converted filings rather than loading every header first", async () => {
    await seed(5);
    const repo = globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN);
    const getAll = vi.spyOn(repo, "getAll");

    const out = await new IndexFilingSectionsTask().run({ limit: 0 });

    // `getAll()` on the unscoped path is the whole converted corpus in memory
    // — hundreds of thousands of rows to take the first few of.
    expect(getAll).not.toHaveBeenCalled();
    expect(out).toMatchObject({ indexed: 0, truncated: true });
  });

  it("streams a scoped selection by page too", async () => {
    await seed(3);
    const repo = globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN);
    const query = vi.spyOn(repo, "query");
    const queryPage = vi.spyOn(repo, "queryPage");

    const out = await new IndexFilingSectionsTask().run({ cik: 320193, limit: 0 });

    expect(query).not.toHaveBeenCalled();
    expect(queryPage).toHaveBeenCalled();
    expect(out.truncated).toBe(true);
  });

  it("reports no truncation when the scope leaves nothing to index", async () => {
    // Every filing predates `since`, so the run stopping at its limit would be
    // a lie: there is nothing behind it. `sec ask` prints that as advice to run
    // a build that has no work to do.
    await seed(3, "2020-01-02");

    const out = await new IndexFilingSectionsTask().run({ since: "2026-01-01", limit: 0 });

    expect(out).toMatchObject({ indexed: 0, skipped: 0, truncated: false });
  });

  it("reports no truncation when there is nothing converted at all", async () => {
    const out = await new IndexFilingSectionsTask().run({ limit: 0 });

    expect(out).toMatchObject({ indexed: 0, sections: 0, skipped: 0, truncated: false });
  });
});
