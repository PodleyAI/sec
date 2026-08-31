/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, expect, test } from "vitest";
import { createServiceToken, type ITabularStorage } from "workglow";
import {
  registerDatabaseExtension,
  listDatabaseExtensionTokens,
  registerDatabaseSetupHook,
  runDatabaseSetupHooks,
  registerDatabaseViews,
  listDatabaseViewDdl,
  listDatabaseViewNames,
  clearDatabaseExtensionsForTesting,
} from "./databaseExtensions";

afterEach(() => clearDatabaseExtensionsForTesting());

test("registered tokens are listed once, in order (deduped)", () => {
  const a = createServiceToken<ITabularStorage<any, any>>("test.a");
  const b = createServiceToken<ITabularStorage<any, any>>("test.b");
  registerDatabaseExtension([a]);
  registerDatabaseExtension([b, a]); // dedupe a
  expect(listDatabaseExtensionTokens()).toEqual([a, b]);
});

test("empty by default", () => {
  expect(listDatabaseExtensionTokens()).toEqual([]);
});

test("setup hooks run once each, deduped, in registration order", () => {
  const calls: string[] = [];
  const a = (): void => void calls.push("a");
  const b = (): void => void calls.push("b");
  registerDatabaseSetupHook(a);
  registerDatabaseSetupHook(b);
  registerDatabaseSetupHook(a); // dedupe
  runDatabaseSetupHooks();
  expect(calls).toEqual(["a", "b"]);
});

test("views dedupe on their NAMES, not on the object handed in", () => {
  // The registering function is called twice in one process — by the CLI
  // preAction hook and again by the database setup hook — and it builds its
  // argument at the call site, so the same views arrive as two different
  // objects. Deduping by identity would create and drop each view twice and
  // grow the registry for the life of the process; only `CREATE VIEW IF NOT
  // EXISTS` hides it, and a contributor writing a plain `CREATE VIEW` gets a
  // duplicate-object error on the second pass.
  const views = { ddl: ["CREATE VIEW v AS SELECT 1"], names: ["v"] };
  registerDatabaseViews({ ...views });
  registerDatabaseViews({ ...views });
  expect(listDatabaseViewNames()).toEqual(["v"]);
  expect(listDatabaseViewDdl()).toHaveLength(1);
});

test("a later registration of the same names replaces the earlier DDL", () => {
  registerDatabaseViews({ ddl: ["CREATE VIEW v AS SELECT 1"], names: ["v"] });
  registerDatabaseViews({ ddl: ["CREATE VIEW v AS SELECT 2"], names: ["v"] });
  expect(listDatabaseViewDdl()).toEqual(["CREATE VIEW v AS SELECT 2"]);
});

test("views are empty by default and cleared for testing", () => {
  expect(listDatabaseViewNames()).toEqual([]);
  registerDatabaseViews({ ddl: ["CREATE VIEW v AS SELECT 1"], names: ["v"] });
  clearDatabaseExtensionsForTesting();
  expect(listDatabaseViewNames()).toEqual([]);
});
