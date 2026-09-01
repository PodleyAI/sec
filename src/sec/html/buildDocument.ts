/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DocumentRootNode, FlatBlock } from "workglow";
import { buildDocumentTree } from "workglow";
import type { EdgarBlock } from "./types";

/** Map de-paginated EdgarBlock[] to libs FlatBlock[] and nest into a Document. */
export function buildDocument(title: string, blocks: EdgarBlock[]): DocumentRootNode {
  const flat: FlatBlock[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        flat.push({ kind: "heading", level: b.level, title: b.text });
        break;
      case "paragraph":
      case "table":
      case "list":
      case "image":
        flat.push({ kind: "leaf", node: b.node });
        break;
      case "page-break":
        break; // dropped
      default: {
        // Exhaustiveness guard: a new EdgarBlock variant must be handled here
        // rather than silently dropped. Throw (not return) so an unhandled
        // variant fails loudly instead of yielding an invalid document.
        const _exhaustive: never = b;
        throw new Error(`Unhandled EdgarBlock variant: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
  return buildDocumentTree(title, flat);
}
