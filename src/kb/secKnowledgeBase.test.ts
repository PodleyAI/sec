/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetAllDatabases } from "../config/resetAllDatabases";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { withSqliteDb } from "../config/testing/withSqliteDb";
import { SEC_DB_TYPE } from "../config/tokens";
import { SEC_EMBEDDING_DIMENSIONS } from "../config/models";
import { getDb } from "../util/db";
import { KB_INDEX_TABLE, SEC_KB_TABLE_NAMES } from "./secKbTables";
import { getSecKnowledgeBase, resetSecKnowledgeBaseForTesting } from "./secKnowledgeBase";

describe("getSecKnowledgeBase", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await resetSecKnowledgeBaseForTesting();
  });

  afterEach(async () => {
    await resetSecKnowledgeBaseForTesting();
    resetDependencyInjectionsForTesting();
  });

  it("refuses a Postgres deployment by name, rather than opening a stray SQLite file", async () => {
    // `getDb()` would throw its own error one frame deeper. Refusing here says
    // which knob is wrong and what the two ways forward are.
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    await expect(getSecKnowledgeBase()).rejects.toThrow(/SEC_DB_TYPE/);
  });
});

/**
 * Two embedding models put their vectors in unrelated spaces, so a query
 * embedded by one and chunks embedded by another retrieve whatever happens to
 * be nearest — and `ask` prints those hits as citations, with no sign that the
 * index and the question disagree about what a vector means. Nothing recorded
 * which model had built the index, so nothing could tell.
 */
describe("the SEC knowledge base's embedding-model record", () => {
  withSqliteDb("kb_model", []);

  beforeEach(async () => {
    await resetSecKnowledgeBaseForTesting();
    delete process.env.SEC_EMBEDDING_MODEL;
  });

  afterEach(async () => {
    await resetSecKnowledgeBaseForTesting();
    delete process.env.SEC_EMBEDDING_MODEL;
  });

  it("reopens an index built by the same model", async () => {
    process.env.SEC_EMBEDDING_MODEL = "onnx:Xenova/bge-base-en-v1.5:q8";
    await getSecKnowledgeBase();
    await resetSecKnowledgeBaseForTesting();

    await expect(getSecKnowledgeBase()).resolves.toBeDefined();
  });

  it("refuses an index built by a different model, naming both and the way back", async () => {
    process.env.SEC_EMBEDDING_MODEL = "onnx:Xenova/bge-base-en-v1.5:q8";
    await getSecKnowledgeBase();
    await resetSecKnowledgeBaseForTesting();

    // Same width, different space — the case a dimension check alone misses,
    // and the one that answers questions instead of failing.
    process.env.SEC_EMBEDDING_MODEL = "onnx:Xenova/all-mpnet-base-v2:q8";
    const failure = getSecKnowledgeBase();
    await expect(failure).rejects.toThrow(/bge-base-en-v1\.5/);
    await expect(failure).rejects.toThrow(/all-mpnet-base-v2/);
    await expect(failure).rejects.toThrow(/SEC_EMBEDDING_MODEL/);
  });

  it("adopts an index that predates the record rather than stranding it", async () => {
    // Nothing on disk says what built such an index, so there is no mismatch to
    // report — but the model is recorded on the way through, and the run after
    // it is checked.
    const db = getDb();
    db.exec(`DROP TABLE IF EXISTS "${KB_INDEX_TABLE}"`);
    process.env.SEC_EMBEDDING_MODEL = "onnx:Xenova/bge-base-en-v1.5:q8";

    await expect(getSecKnowledgeBase()).resolves.toBeDefined();

    await resetSecKnowledgeBaseForTesting();
    process.env.SEC_EMBEDDING_MODEL = "onnx:Xenova/all-mpnet-base-v2:q8";
    await expect(getSecKnowledgeBase()).rejects.toThrow(/not comparable/);
  });
});

/**
 * The knowledge base's tables are built lazily and directly against `getDb()`,
 * so `createStorage`'s ownership registry never sees them.
 *
 * A reset that leaves `kb_document` standing is worse than one that leaves
 * nothing: every filing then anti-joins as "already indexed", so a re-load
 * followed by `sec index` reports success having embedded nothing, and `ask`
 * answers from vectors of documents the database no longer holds.
 */
describe("the SEC knowledge base's tables and `db reset`", () => {
  withSqliteDb("kb_reset", []);

  afterEach(async () => {
    await resetSecKnowledgeBaseForTesting();
  });

  const tableNames = (): string[] =>
    (
      getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);

  it("drops the index along with the rest of sec's tables", async () => {
    await getSecKnowledgeBase();
    expect(tableNames()).toEqual(expect.arrayContaining([...SEC_KB_TABLE_NAMES]));

    await resetAllDatabases();

    const remaining = tableNames();
    for (const table of SEC_KB_TABLE_NAMES) {
      expect(remaining, table).not.toContain(table);
    }
  });

  it("counts them as sec's own, so a reset does not report them as orphans", async () => {
    await getSecKnowledgeBase();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await resetAllDatabases();
      const warnings = warn.mock.calls
        .map((args: readonly unknown[]) => String(args[0]))
        .join("\n");
      for (const table of SEC_KB_TABLE_NAMES) {
        expect(warnings, table).not.toContain(table);
      }
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * Search over a real SQLite chunk store, which is the only thing that
 * exercises the vector column's decode. `getSecKnowledgeBase` is the seam that
 * chooses the storage class, so the assertion is deliberately end-to-end from
 * there rather than against a store the test constructs itself.
 *
 * This is the shape that broke: `@workglow/sqlite` <= 0.4.7 JSON-parsed a
 * column `getAll()` had already decoded to a `Float32Array`, so every search
 * threw "Unable to parse JSON string" and nothing in this repo noticed,
 * because nothing here searched.
 */
describe("the SEC knowledge base's chunk search", () => {
  withSqliteDb("kb_search", []);

  const unit = (index: number): Float32Array => {
    const vector = new Float32Array(SEC_EMBEDDING_DIMENSIONS);
    vector[index] = 1;
    return vector;
  };

  beforeEach(async () => {
    await resetSecKnowledgeBaseForTesting();
  });

  afterEach(async () => {
    await resetSecKnowledgeBaseForTesting();
  });

  it("ranks stored chunks by cosine distance from the query", async () => {
    const kb = await getSecKnowledgeBase();
    await kb.upsertChunk({
      chunk_id: "north",
      doc_id: "doc-1",
      vector: unit(0),
      metadata: {
        chunkId: "north",
        doc_id: "doc-1",
        depth: 0,
        nodePath: ["north"],
        text: "the north section",
      },
    });
    await kb.upsertChunk({
      chunk_id: "east",
      doc_id: "doc-1",
      vector: unit(1),
      metadata: {
        chunkId: "east",
        doc_id: "doc-1",
        depth: 0,
        nodePath: ["east"],
        text: "the east section",
      },
    });

    const hits = await kb.similaritySearch(unit(1), { topK: 2 });
    expect(hits.map((hit) => hit.chunk_id)).toEqual(["east", "north"]);
  });
});
