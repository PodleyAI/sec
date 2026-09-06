/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Static, Type } from "typebox";
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
  unregisterKnowledgeBase,
} from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { SecCliConfigurationError } from "../config/EnvToDI";
import { secEmbeddingModel, SEC_EMBEDDING_DIMENSIONS } from "../config/models";
import { SEC_DB_TYPE } from "../config/tokens";
import { getDb } from "../util/db";
import { KB_CHUNK_TABLE, KB_DOCUMENT_TABLE, KB_INDEX_TABLE } from "./secKbTables";

/** The one knowledge base, under the id `sec ask` resolves it by. */
export const SEC_KB_ID = "sec";

/**
 * What built the stored vectors.
 *
 * One row, because there is one index. Two embedding models produce vectors in
 * unrelated spaces even at the same width, so a query embedded by a different
 * model than the chunks retrieves whatever happens to be nearest — and `ask`
 * cites it as confidently as a real hit.
 */
const KbIndexSchema = Type.Object({
  id: Type.String({ maxLength: 16 }),
  /** The `SEC_EMBEDDING_MODEL` id the chunks were embedded with. */
  embedding_model: Type.String({ maxLength: 256 }),
  /** The vector column's width, which the model fixes. */
  dimensions: Type.Integer(),
  built_at: Type.String({ maxLength: 32 }),
});

const KbIndexPrimaryKeyNames = ["id"] as const;

type KbIndexRow = Static<typeof KbIndexSchema>;

/** The single row's key. */
const KB_INDEX_ROW_ID = "sec";

let cached: KnowledgeBase | undefined;

/**
 * Refuses an index built by a different embedding model, and records the model
 * when nothing has yet.
 *
 * An index with no row is adopted rather than refused: nothing on disk says
 * what built it, so there is no mismatch to report, and refusing would strand
 * every index created before this row existed. From the first run onward the
 * record is what the next run is checked against.
 */
async function requireMatchingEmbeddingModel(
  store: {
    get(key: { id: string }): Promise<KbIndexRow | undefined>;
    put(row: KbIndexRow): Promise<KbIndexRow>;
  },
  model: string,
  dimensions: number
): Promise<void> {
  const stored = await store.get({ id: KB_INDEX_ROW_ID });

  if (stored === undefined) {
    if (isDryRun()) return;
    await store.put({
      id: KB_INDEX_ROW_ID,
      embedding_model: model,
      dimensions,
      built_at: new Date().toISOString(),
    });
    return;
  }

  if (stored.embedding_model === model && stored.dimensions === dimensions) return;

  throw new SecCliConfigurationError(
    `The knowledge base was indexed with "${stored.embedding_model}" ` +
      `(${stored.dimensions}-wide vectors), and SEC_EMBEDDING_MODEL now resolves to ` +
      `"${model}" (${dimensions}-wide). Vectors from two models are not comparable, so ` +
      `searching this index would return citations that look authoritative and are not. ` +
      `Set SEC_EMBEDDING_MODEL="${stored.embedding_model}" to keep using it, or drop ` +
      `${KB_DOCUMENT_TABLE}, ${KB_CHUNK_TABLE} and ${KB_INDEX_TABLE} and re-run \`sec index\` ` +
      `to rebuild it with the new model.`
  );
}

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
    KB_DOCUMENT_TABLE,
    DocumentStorageSchema,
    DocumentStorageKey
  );
  const chunks = new SqliteVectorStorage(
    db,
    KB_CHUNK_TABLE,
    ChunkVectorStorageSchema,
    ChunkVectorPrimaryKey,
    [],
    SEC_EMBEDDING_DIMENSIONS
  );
  const index = new SqliteTabularStorage(db, KB_INDEX_TABLE, KbIndexSchema, KbIndexPrimaryKeyNames);
  await documents.setupDatabase();
  await chunks.setupDatabase();
  await index.setupDatabase();

  const model = secEmbeddingModel();
  // Before the knowledge base is handed out, so a mismatch cannot be discovered
  // partway through a run that has already embedded chunks into the old space.
  await requireMatchingEmbeddingModel(index, model, SEC_EMBEDDING_DIMENSIONS);

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

/**
 * Test-only. Both caches are process-global: this module's, and the knowledge
 * base registry `getKnowledgeBase` reads — a base left in the second one is
 * handed back still bound to the database a later test has since closed.
 */
export async function resetSecKnowledgeBaseForTesting(): Promise<void> {
  cached = undefined;
  // Unregistering one that was never registered throws, and a reset that
  // depends on having run after a registration is no reset at all.
  if (getKnowledgeBase(SEC_KB_ID) === undefined) return;
  await unregisterKnowledgeBase(SEC_KB_ID);
}
