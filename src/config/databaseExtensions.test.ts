/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, expect, test } from "bun:test";
import { createServiceToken, type ITabularStorage } from "workglow";
import {
  registerDatabaseExtension,
  listDatabaseExtensionTokens,
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
