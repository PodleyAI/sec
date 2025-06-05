//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TSchema, Kind } from "@sinclair/typebox";
import { Readable } from "node:stream";

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
    if (currentSchema[Kind] === "Array") {
      arrayPaths.push(currentPath);
      // Also walk the array items to find nested arrays
      if (currentSchema.items) {
        walk(currentSchema.items as TSchema, currentPath);
      }
    } else if (currentSchema[Kind] === "Object" && currentSchema.properties) {
      for (const [key, value] of Object.entries(currentSchema.properties)) {
        const newPath = currentPath ? `${currentPath}.${key}` : key;
        walk(value as TSchema, newPath);
      }
    } else if (currentSchema[Kind] === "Union" && currentSchema.anyOf) {
      // Handle unions by checking each variant
      for (const variant of currentSchema.anyOf) {
        walk(variant as TSchema, currentPath);
      }
    } else if (currentSchema[Kind] === "Composite" && currentSchema.allOf) {
      // Handle composite types
      for (const part of currentSchema.allOf) {
        walk(part as TSchema, currentPath);
      }
    } else if (currentSchema[Kind] === "Optional" && currentSchema.type) {
      // Handle optional types
      walk(currentSchema.type as TSchema, currentPath);
    }
  }

  walk(schema, basePath);
  return arrayPaths;
}
