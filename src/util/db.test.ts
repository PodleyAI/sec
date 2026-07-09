/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { SecCliConfigurationError } from "../config/EnvToDI";
import { SEC_DB_TYPE } from "../config/tokens";
import { closeDb, getDb } from "./db";

describe("getDb", () => {
  beforeEach(() => {
    closeDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("throws SecCliConfigurationError when SEC_DB_TYPE is postgres", () => {
    // Regression: getDb() used to silently open a SQLite file regardless of
    // SEC_DB_TYPE, causing rows to land in a file that nothing else reads
    // when the rest of the system was wired to Postgres.
    const hadPrevious = globalServiceRegistry.has(SEC_DB_TYPE);
    const previous = hadPrevious ? globalServiceRegistry.get(SEC_DB_TYPE) : null;
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    try {
      expect(() => getDb()).toThrow(SecCliConfigurationError);
    } finally {
      // Re-register the prior value (or "sqlite" as a safe default if no
      // prior was set). The registry has no unregister API, so this is the
      // closest we can get to leaving state untouched for other tests.
      globalServiceRegistry.registerInstance(SEC_DB_TYPE, previous ?? "sqlite");
    }
  });
});
