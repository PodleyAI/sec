/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CheerioAPI } from "cheerio";

/** Node accepted by `$(node)` — cheerio's domhandler element at runtime. */
export type CheerioAcceptedNode = NonNullable<Parameters<CheerioAPI>[0]>;

/** Minimal DOM node shape used by cheerio's htmlparser2 backend. */
export interface DomNode {
  readonly type: string;
  readonly parent: DomNode | null;
  readonly children?: readonly DomNode[];
}

/** Element node from cheerio's DOM tree (e.g. `.toArray()` on element selectors). */
export interface DomElement extends DomNode {
  readonly type: "tag" | "script" | "style";
  readonly tagName: string;
  readonly attribs: Record<string, string>;
  readonly children: readonly DomNode[];
}

/** Text node from cheerio's DOM tree. */
export interface DomTextNode extends DomNode {
  readonly type: "text";
  readonly data: string;
}
