/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, test } from "vitest";
import { SEC_STORAGE_REGISTRY } from "./storageRegistry";

test("every descriptor carries the fields a registration loop reads", () => {
  const bad = SEC_STORAGE_REGISTRY.filter(
    (d) =>
      typeof d.table !== "string" ||
      d.table.length === 0 ||
      d.token === undefined ||
      d.schema === undefined ||
      !Array.isArray(d.primaryKeyNames) ||
      d.primaryKeyNames.length === 0
  ).map((d) => d.table);
  expect(bad).toEqual([]);
});

test("no two descriptors claim the same table or the same token", () => {
  const tables = SEC_STORAGE_REGISTRY.map((d) => d.table);
  expect(tables).toEqual([...new Set(tables)]);
  const tokens = SEC_STORAGE_REGISTRY.map((d) => d.token.id);
  expect(tokens).toEqual([...new Set(tokens)]);
});

test("index declarations are columns of their own schema", () => {
  const wrong: string[] = [];
  for (const d of SEC_STORAGE_REGISTRY) {
    const columns = new Set(Object.keys(d.schema.properties));
    const members = [
      ...(d.indexes ?? []).flatMap((i) => (Array.isArray(i) ? i : [i])),
      ...(d.uniqueIndexes ?? []).flat(),
    ];
    for (const m of members) {
      if (!columns.has(m as string)) wrong.push(`${d.table}.${String(m)}`);
    }
  }
  expect(wrong).toEqual([]);
});
