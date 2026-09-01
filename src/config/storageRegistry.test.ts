/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { Type } from "typebox";
import { afterEach, expect, test } from "vitest";
import type { AnyTabularStorage } from "workglow";
import { createServiceToken, globalServiceRegistry, InMemoryTabularStorage } from "workglow";
import { defineStorage, registerStorages, SEC_STORAGE_REGISTRY } from "./storageRegistry";
import { resetDependencyInjectionsForTesting } from "./TestingDI";

const DemoSchema = Type.Object({
  id: Type.String({ maxLength: 16 }),
  label: Type.String({ maxLength: 32 }),
});
const DemoPrimaryKeyNames = ["id"] as const;
const DEMO_TOKEN = createServiceToken<AnyTabularStorage>("test.demo.storage");

// The registry is process-global; this is how every other test here clears it.
afterEach(() => resetDependencyInjectionsForTesting());

test("registerStorages binds each descriptor's token to what the factory returns", () => {
  const seen: string[] = [];
  registerStorages(
    [
      defineStorage({
        token: DEMO_TOKEN,
        table: "demo",
        schema: DemoSchema,
        primaryKeyNames: DemoPrimaryKeyNames,
      }),
    ],
    (d) => {
      seen.push(d.table);
      return new InMemoryTabularStorage(d.schema, d.primaryKeyNames) as AnyTabularStorage;
    }
  );
  expect(seen).toEqual(["demo"]);
  expect(globalServiceRegistry.get(DEMO_TOKEN)).toBeInstanceOf(InMemoryTabularStorage);
});

test("registerStorages preserves array order", () => {
  const order: string[] = [];
  registerStorages(SEC_STORAGE_REGISTRY, (d) => {
    order.push(d.table);
    return new InMemoryTabularStorage(d.schema, d.primaryKeyNames) as AnyTabularStorage;
  });
  expect(order).toEqual(SEC_STORAGE_REGISTRY.map((d) => d.table));
});

test("a descriptor carries its index declarations through erasure", () => {
  const d = defineStorage({
    token: DEMO_TOKEN,
    table: "demo",
    schema: DemoSchema,
    primaryKeyNames: DemoPrimaryKeyNames,
    indexes: ["label", ["id", "label"]],
    uniqueIndexes: [["label"]],
  });
  expect(d.indexes).toEqual(["label", ["id", "label"]]);
  expect(d.uniqueIndexes).toEqual([["label"]]);
});
