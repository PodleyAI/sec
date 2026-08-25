/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  chunkRiskFactorText,
  MAX_RISK_FACTORS_CHARS,
  RISK_FACTOR_CHUNK_CHARS,
} from "../sec/forms/registration-statements/s1/riskFactorChunks";
import { alphanumeric } from "./coverage";

export interface ChunkRecord {
  readonly index: number;
  readonly chars: number;
  readonly carriedHeading: string | null;
  /** The carried line must be verbatim section text, or spans stop verifying. */
  readonly carriedHeadingVerbatim: boolean;
  /**
   * A GFM table split across two chunks. The chunker splits on paragraph
   * boundaries and a rendered table is one paragraph per row, so a table inside
   * a risk section can be cut in half — handing the model rows with no header
   * and a header with no rows.
   */
  readonly opensMidTable: boolean;
  readonly closesMidTable: boolean;
}

export interface ChunkTrace {
  readonly sectionChars: number;
  readonly oversized: boolean;
  readonly chunkChars: number;
  readonly chunks: readonly ChunkRecord[];
  /**
   * Every paragraph of the section appears in some chunk, and no chunk carries
   * text the section does not. False means the split lost or invented prose.
   */
  readonly reassembles: boolean;
  readonly splitTables: number;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;

function tableEdges(text: string): { readonly opens: boolean; readonly closes: boolean } {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const first = lines[0] ?? "";
  const last = lines[lines.length - 1] ?? "";
  // A chunk opening on a row that is not a header separator, or ending on a row
  // with more to come, is a table the split ran through.
  return { opens: TABLE_ROW.test(first), closes: TABLE_ROW.test(last) };
}

/** Split a risk-factor section the way the extractor will, and check the split. */
export function buildChunkTrace(
  sectionText: string,
  maxChars: number = RISK_FACTOR_CHUNK_CHARS
): ChunkTrace {
  const chunks = chunkRiskFactorText(sectionText, maxChars);
  const sectionNormalized = alphanumeric(sectionText);
  const records: ChunkRecord[] = chunks.map((chunk, index) => {
    const edges = tableEdges(chunk.text);
    return {
      index,
      chars: chunk.text.length,
      carriedHeading: chunk.carriedHeading,
      carriedHeadingVerbatim:
        chunk.carriedHeading === null ||
        sectionNormalized.includes(alphanumeric(chunk.carriedHeading)),
      opensMidTable: index > 0 && edges.opens,
      closesMidTable: index < chunks.length - 1 && edges.closes,
    };
  });

  // Reassembly is checked on content, not on string equality: every chunk after
  // the first carries a heading the section already contains, so concatenating
  // them cannot equal the section verbatim by construction.
  const covered = chunks.every((chunk) =>
    chunk.text
      .split(/\n{2,}/)
      .map((p) => alphanumeric(p))
      .filter((p) => p.length > 0)
      .every((p) => sectionNormalized.includes(p))
  );
  const chunkNormalized = chunks.map((c) => alphanumeric(c.text)).join("");
  const complete = sectionText
    .split(/\n{2,}/)
    .map((p) => alphanumeric(p))
    .filter((p) => p.length > 0)
    .every((p) => chunkNormalized.includes(p));

  return {
    sectionChars: sectionText.length,
    oversized: sectionText.length > MAX_RISK_FACTORS_CHARS,
    chunkChars: maxChars,
    chunks: records,
    reassembles: covered && complete,
    splitTables: records.filter((r) => r.opensMidTable || r.closesMidTable).length,
  };
}
