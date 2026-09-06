/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Document metadata, keyed by the accession and member a chunk came from. */
export const KB_DOCUMENT_TABLE = "kb_document";
/** Chunk vectors, beside every other table in the same database. */
export const KB_CHUNK_TABLE = "kb_chunk";
/** One row recording which embedding model built the index. */
export const KB_INDEX_TABLE = "kb_index";

/**
 * The tables the knowledge base owns.
 *
 * Named here rather than derived from `createStorage`'s registry, because these
 * three are not built through it: the chunk store is a vector storage created
 * at a fixed width against the connection `getDb()` owns, and all three are
 * built lazily by the first command that opens the index. A process that never
 * opens it still has to know they are sec's — `db reset` reads this list, and a
 * table missing from it survives a reset, leaving `sec ask` answering from
 * vectors of filings the database no longer holds.
 */
export const SEC_KB_TABLE_NAMES: readonly string[] = [
  KB_DOCUMENT_TABLE,
  KB_CHUNK_TABLE,
  KB_INDEX_TABLE,
];
