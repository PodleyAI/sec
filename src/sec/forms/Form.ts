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
 * This is best-effort hygiene only and is NOT the security boundary against
 * filer-declared entity expansion — the real seal is `processEntities` being
 * fully disabled in the XMLParser config, plus the post-parse
 * {@link decodePredefinedEntities} walker that decodes only the five
 * predefined XML entities. The regex anchors on the very start of the
 * document and so misses DOCTYPEs that follow a leading XML comment, PI, or
 * unusual whitespace; that's why the parser-side defense had to be tightened.
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
 * Recursively decode the five predefined XML entities (`&amp;`, `&lt;`,
 * `&gt;`, `&quot;`, `&apos;`) in every string field of a parsed XML object.
 *
 * This runs as a post-parse pass when the underlying XMLParser is configured
 * with `processEntities: { enabled: false }` — that flag is the security seal
 * that prevents any filer-declared `<!ENTITY ...>` from being expanded even
 * if a DOCTYPE somehow reached the parser (e.g. after a leading XML comment
 * or PI that {@link stripDoctype} doesn't see). With expansion disabled the
 * parser preserves every `&...;` byte sequence literally, including the
 * predefined ones, so this walker is what restores the intended round-trip
 * (e.g. `&amp;` → `&`).
 *
 * Single-pass and one-shot: the regex matches each predefined entity in one
 * scan and replaces with its literal character — `&amp;lt;` decodes to
 * `&lt;` rather than `<` because the `amp;` is matched first and consumed
 * before the scan moves past `lt;`. That preserves the input/output
 * symmetry the legacy `processEntities: { enabled: true }` mode had.
 *
 * Pure: returns new arrays/objects for plain containers; leaves
 * `number`/`boolean`/`null`/`undefined`/`Date`/typed arrays untouched.
 */
const PREDEFINED_ENTITY_RE = /&(amp|lt|gt|quot|apos);/g;
function decodeOnePassString(s: string): string {
  return s.replace(PREDEFINED_ENTITY_RE, (_, name) =>
    name === "amp" ? "&" : name === "lt" ? "<" : name === "gt" ? ">" : name === "quot" ? '"' : "'"
  );
}
export function decodePredefinedEntities<T>(value: T): T {
  if (typeof value === "string") {
    return decodeOnePassString(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => decodePredefinedEntities(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object" && (value as any).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object)) {
      out[k] = decodePredefinedEntities((value as Record<string, unknown>)[k]);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Thin wrapper around an XMLParser instance that strips any DOCTYPE
 * declaration before parsing and post-decodes the five predefined XML
 * entities. Returned by {@link Form.getParser}.
 */
export interface FormXmlParser {
  parse(xml: string): unknown;
}

export abstract class Form {
  static readonly name: string;
  static readonly description: string;
  static readonly forms: readonly string[];
  static async parse(form: string, xml: string): Promise<unknown> {
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
      // Disable parser-side entity expansion entirely. Filer-controlled XML
      // can declare an entity chain that explodes geometrically under
      // expansion ("billion laughs"), and `stripDoctype` is a regex on the
      // raw text that misses DOCTYPE declarations following a leading XML
      // comment or processing instruction — so the only sound seal is to
      // refuse expansion at the parser layer. With `enabled: false` the
      // parser preserves every `&...;` byte sequence literally; the
      // post-parse `decodePredefinedEntities` walker then restores the
      // round-trip for the five safe predefined entities so values like
      // `Mac Accounting Group &amp; CPAs, LLP` still come out as
      // `Mac Accounting Group & CPAs, LLP`.
      processEntities: {
        enabled: false,
      },
      isArray: (_name, jpath) => {
        return typeof jpath === "string" && paths.includes(jpath);
      },
    };
    const parser = new XMLParser(options);
    return {
      parse(xml: string): unknown {
        return decodePredefinedEntities(parser.parse(stripDoctype(xml)));
      },
    };
  }
}

/**
 * The static side of a {@link Form} subclass, optionally carrying the type its
 * {@link Form.parse} produces.
 *
 * The parsed type is a parameter of this alias rather than of `Form` itself
 * because `parse` is `static`: TypeScript forbids a static member from
 * referencing a class type parameter, so `abstract class Form<TParsed>` cannot
 * type its own `parse`. Registries that hold mixed form classes keep the
 * default `unknown`; `ParsedFormDocument` (`./parsedFormDocument`) is what
 * recovers the concrete type per form name.
 */
export type FormConstructor<TParsed = unknown> = typeof Form & {
  parse(form: string, xml: string): Promise<TParsed>;
};
