/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { SEC_DB_TYPE } from "../config/tokens";
import { getSecKnowledgeBase, resetSecKnowledgeBaseForTesting } from "./secKnowledgeBase";

describe("getSecKnowledgeBase", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    resetSecKnowledgeBaseForTesting();
  });

  afterEach(() => {
    resetSecKnowledgeBaseForTesting();
    resetDependencyInjectionsForTesting();
  });

  it("refuses a Postgres deployment by name, rather than opening a stray SQLite file", async () => {
    // `getDb()` would throw its own error one frame deeper. Refusing here says
    // which knob is wrong and what the two ways forward are.
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    await expect(getSecKnowledgeBase()).rejects.toThrow(/SEC_DB_TYPE/);
  });
});
