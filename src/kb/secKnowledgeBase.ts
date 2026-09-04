/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChunkVectorPrimaryKey,
  ChunkVectorStorageSchema,
  createStandardKbStrategy,
  DocumentStorageKey,
  DocumentStorageSchema,
  getKnowledgeBase,
  globalServiceRegistry,
  KnowledgeBase,
  registerKnowledgeBase,
  SqliteTabularStorage,
  SqliteVectorStorage,
} from "workglow";
import { SecCliConfigurationError } from "../config/EnvToDI";
import { secEmbeddingModel, SEC_EMBEDDING_DIMENSIONS } from "../config/models";
import { SEC_DB_TYPE } from "../config/tokens";
import { getDb } from "../util/db";

/** The one knowledge base, under the id `sec ask` resolves it by. */
export const SEC_KB_ID = "sec";

/** Chunk vectors, beside every other table in the same database. */
const CHUNK_TABLE = "kb_chunk";
/** Document metadata, keyed by the accession and member a chunk came from. */
const DOCUMENT_TABLE = "kb_document";

let cached: KnowledgeBase | undefined;

/**
 * The knowledge base `sec index` fills and `sec ask` reads.
 *
 * Built directly rather than through `createKnowledgeBase`, which wires
 * in-memory storages: those are right for that factory's examples and wrong
 * here, where the whole point is that an index survives the process that built
 * it.
 *
 * SQLite only, and deliberately so. The vector store is
 * `@workglow/sqlite`'s, sharing the one connection `getDb()` owns so the index
 * lives in the same file as the filings it indexes; a Postgres deployment has
 * `pgvector` available and wiring it is a different exercise than this example
 * sets out to demonstrate.
 */
export async function getSecKnowledgeBase(): Promise<KnowledgeBase> {
  if (cached !== undefined) return cached;
  const existing = getKnowledgeBase(SEC_KB_ID);
  if (existing !== undefined) {
    cached = existing;
    return existing;
  }

  const backend = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : "sqlite";
  if (backend !== "sqlite") {
    throw new SecCliConfigurationError(
      `\`sec ask\` stores its index in SQLite, and SEC_DB_TYPE is "${backend}". ` +
        "Point SEC_DB_TYPE at sqlite, or index against a separate SQLite database."
    );
  }

  const db = getDb();
  // Tabular, not vector: the document table holds a filing's metadata and its
  // node tree. Only the chunks carry embeddings.
  const documents = new SqliteTabularStorage(
    db,
    DOCUMENT_TABLE,
    DocumentStorageSchema,
    DocumentStorageKey
  );
  const chunks = new SqliteVectorStorage(
    db,
    CHUNK_TABLE,
    ChunkVectorStorageSchema,
    ChunkVectorPrimaryKey,
    [],
    SEC_EMBEDDING_DIMENSIONS
  );
  await documents.setupDatabase();
  await chunks.setupDatabase();

  const model = secEmbeddingModel();
  const kb = new KnowledgeBase(SEC_KB_ID, documents as never, chunks as never, {
    title: "SEC filings",
    description: "Markdown sections converted from EDGAR filings.",
    docEmbeddingModel: model,
    aiStrategy: createStandardKbStrategy(),
  });
  await registerKnowledgeBase(SEC_KB_ID, kb);
  cached = kb;
  return kb;
}

/** Test-only: the cache is process-global. */
export function resetSecKnowledgeBaseForTesting(): void {
  cached = undefined;
}
