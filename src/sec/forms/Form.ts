/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// See https://www.sec.gov/files/edgar/filermanual/edgarfilermmanual-vol2-c3.pdf

import { X2jOptions, XMLParser } from "fast-xml-parser";
import type { TObject } from "typebox";
import { extractArrayPaths } from "./parse_util";

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
  protected static getParser(schema: TObject): XMLParser {
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
      // Disable entity expansion. A filer-controlled XML payload that
      // declares N references each pointing at a node containing N
      // references explodes geometrically under expansion ("billion laughs"),
      // and the parser hands us untrusted SGML/XML directly from the filer.
      // Stays-literal preserves the raw `&entity;` byte sequence — the
      // downstream consumers either don't read it or HTML-decode their own
      // entity references explicitly.
      processEntities: false,
      isArray: (_name, jpath) => {
        return typeof jpath === "string" && paths.includes(jpath);
      },
    };
    return new XMLParser(options);
  }
}

export type FormConstructor = typeof Form & {
  parse(form: string, xml: string): Promise<any>;
};
