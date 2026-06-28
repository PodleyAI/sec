/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// See https://www.sec.gov/files/edgar/filermanual/edgarfilermmanual-vol2-c3.pdf

import { X2jOptions, XMLParser } from "fast-xml-parser";
import type { TObject } from "typebox";
import { extractArrayPaths } from "./parse_util";

/**
 * Strip any leading `<!DOCTYPE ...>` declaration (including a bracketed
 * internal subset like `<!DOCTYPE name [ <!ENTITY xxe "..."> ]>`).
 *
 * The parser still defends in depth via bounded `processEntities`, but
 * pre-stripping the DOCTYPE eliminates any chance of a filer-declared entity
 * being expanded — only the five predefined XML entities (`&amp;`, `&lt;`,
 * `&gt;`, `&quot;`, `&apos;`) remain in play.
 */
export function stripDoctype(xml: string): string {
  // Match `<!DOCTYPE ...>` — either the simple form or the bracketed
  // internal-subset form. The internal subset is delimited by `[ ... ]` and
  // can contain `>` inside `<!ENTITY ...>` declarations, so we find the
  // matching `]` and then the closing `>`. DOCTYPE legally appears between the
  // XML declaration and the root element; we permit any leading whitespace,
  // optional `<?xml ...?>` declaration, and additional whitespace before it.
  return xml.replace(
    /(^\s*(?:<\?xml[^?]*\?>\s*)?)<!DOCTYPE\b[^[>]*(?:\[[\s\S]*?\][^>]*)?>\s*/i,
    "$1"
  );
}

/**
 * Thin wrapper around an XMLParser instance that strips any DOCTYPE
 * declaration before parsing. Returned by {@link Form.getParser}.
 */
export interface FormXmlParser {
  parse(xml: string): any;
}

export abstract class Form {
  static readonly name: string;
  static readonly description: string;
  static readonly forms: readonly string[];
  static async parse(form: string, xml: string): Promise<any> {
    throw new Error(`Parsing not implemented for ${form}`);
  }

  // Keyed by the subclass constructor itself rather than `this.name`, since
  // multiple Form subclasses set `name` to a human-readable description and
  // collisions there would silently return another form's array paths.
  private static _arrayPaths = new WeakMap<Function, string[]>();
  protected static getParser(schema: TObject): FormXmlParser {
    let paths = this._arrayPaths.get(this);
    if (!paths) {
      paths = extractArrayPaths(schema);
      this._arrayPaths.set(this, paths);
    }

    const options: Partial<X2jOptions> = {
      ignoreAttributes: true,
      removeNSPrefix: true,
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
      // Allow decoding of the five predefined XML entities (`&amp;`, `&lt;`,
      // `&gt;`, `&quot;`, `&apos;`) so values like
      // `Mac Accounting Group &amp; CPAs, LLP` round-trip to their intended
      // form. Filer-controlled XML can declare an entity chain that explodes
      // geometrically under expansion ("billion laughs"), so the limits below
      // bound the work the parser will do, and `stripDoctype` removes any
      // filer-declared entity definitions before parsing as a second line of
      // defense. Disabling entity processing entirely (`processEntities:
      // false`) corrupts every value carrying a predefined entity — e.g.
      // `&amp;` would persist as the literal four-character string.
      processEntities: {
        enabled: true,
        maxEntityCount: 64,
        maxExpansionDepth: 4,
        maxExpandedLength: 1_000_000,
        maxTotalExpansions: 10_000,
      },
      isArray: (_name, jpath) => {
        return typeof jpath === "string" && paths.includes(jpath);
      },
    };
    const parser = new XMLParser(options);
    return {
      parse(xml: string): any {
        return parser.parse(stripDoctype(xml));
      },
    };
  }
}

export type FormConstructor = typeof Form & {
  parse(form: string, xml: string): Promise<any>;
};
