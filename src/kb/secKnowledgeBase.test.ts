/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { withSqliteDb } from "../config/testing/withSqliteDb";
import { SEC_DB_TYPE } from "../config/tokens";
import { SEC_EMBEDDING_DIMENSIONS } from "../config/models";
import { getSecKnowledgeBase, resetSecKnowledgeBaseForTesting } from "./secKnowledgeBase";

describe("getSecKnowledgeBase", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    resetSecKnowledgeBaseForTesting();
  });

  afterEach(() => {
    resetSecKnowledgeBaseForTesting();
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

  beforeEach(() => {
    resetSecKnowledgeBaseForTesting();
  });

  afterEach(() => {
    resetSecKnowledgeBaseForTesting();
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
