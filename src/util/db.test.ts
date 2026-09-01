/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { SecCliConfigurationError } from "../config/EnvToDI";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { SEC_DB_TYPE } from "../config/tokens";
import { closeDb, getDb } from "./db";

describe("getDb", () => {
  beforeEach(() => {
    closeDb();
  });

  afterEach(() => {
    closeDb();
    // Strip SEC_DB_TYPE (and any other env-derived binding this test set) so a
    // later test file starts with a clean container.
    resetDependencyInjectionsForTesting();
  });

  it("throws SecCliConfigurationError when SEC_DB_TYPE is postgres", () => {
    // Regression: getDb() used to silently open a SQLite file regardless of
    // SEC_DB_TYPE, causing rows to land in a file that nothing else reads
    // when the rest of the system was wired to Postgres.
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    expect(() => getDb()).toThrow(SecCliConfigurationError);
  });
});
