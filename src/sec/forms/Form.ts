//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

// See https://www.sec.gov/files/edgar/filermanual/edgarfilermmanual-vol2-c3.pdf

import type { TObject } from "@sinclair/typebox";
import { Readable } from "node:stream";
import { extractArrayPaths } from "./parse_util";
import { X2jOptions } from "fast-xml-parser";
import { XMLParser } from "fast-xml-parser";

export abstract class Form {
  static readonly name: string;
  static readonly description: string;
  static readonly forms: readonly string[];
  static async parse(input: string | Readable): Promise<any> {
    throw new Error("parse not implemented");
  }

  private static _arrayPaths = new Map<string, string[]>();
  protected static getParser(schema: TObject): XMLParser {
    if (!this._arrayPaths.has(this.name)) {
      this._arrayPaths.set(this.name, extractArrayPaths(schema));
    }
    const paths = this._arrayPaths.get(this.name)!;

    const options: Partial<X2jOptions> = {
      ignoreAttributes: true,
      removeNSPrefix: true,
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
      isArray: (_name, jpath) => {
        return paths.includes(jpath);
      },
    };
    return new XMLParser(options);
  }
}

export type FormConstructor = typeof Form & {
  parse(input: string | Readable): Promise<any>;
};
