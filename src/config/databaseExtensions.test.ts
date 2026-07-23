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
  clearDatabaseExtensionsForTesting,
} from "./databaseExtensions";

afterEach(() => clearDatabaseExtensionsForTesting());

test("registered tokens are listed once, in order (deduped)", () => {
  const a = createServiceToken<ITabularStorage>("test.a");
  const b = createServiceToken<ITabularStorage>("test.b");
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
