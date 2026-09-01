/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from "node:stream";
import { TSchema, Type } from "typebox";

/** Read a Node.js Readable stream completely into a UTF-8 string */
export async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
// Function to extract array paths from TypeBox schema
export function extractArrayPaths(schema: TSchema, basePath: string = ""): string[] {
  const arrayPaths: string[] = [];

  function walk(currentSchema: TSchema, currentPath: string) {
    if (Type.IsArray(currentSchema)) {
      arrayPaths.push(currentPath);
      // Also walk the array items to find nested arrays
      walk(currentSchema.items, currentPath);
    } else if (Type.IsObject(currentSchema)) {
      for (const [key, value] of Object.entries(currentSchema.properties)) {
        const newPath = currentPath ? `${currentPath}.${key}` : key;
        walk(value, newPath);
      }
    } else if (Type.IsUnion(currentSchema)) {
      // Handle unions by checking each variant
      for (const variant of currentSchema.anyOf) {
        walk(variant, currentPath);
      }
    } else if (Type.IsIntersect(currentSchema)) {
      // Handle composite types
      for (const part of currentSchema.allOf) {
        walk(part, currentPath);
      }
    }
  }

  walk(schema, basePath);
  return arrayPaths;
}
