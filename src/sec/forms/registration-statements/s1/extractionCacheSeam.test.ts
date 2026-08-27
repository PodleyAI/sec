/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The cache is actually wired into the extraction seam.
 *
 * `extractionCache.test.ts` covers the store; this covers the connection —
 * that `runGuardedExtraction` consults it before reaching a provider and
 * writes to it after a validated result. Without this, the whole feature could
 * be correct and inert.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../../config/TestingDI";
import { EXTRACTION_CACHE_REPOSITORY_TOKEN } from "../../../../storage/extraction/ExtractionCacheSchema";
import { extractManagement } from "./sectionExtractors";
import { fakeS1Model, registerFakeStructuredProvider } from "./testing/fakeStructuredProvider";

const SECTION = "Jane Roe has served as our Chief Executive Officer since 2021.";

let unregister: (() => void) | undefined;

describe("extraction cache at the seam", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    delete process.env.SEC_EXTRACTION_CACHE;
    delete process.env.SEC_EXTRACTION_TEMPERATURE;
  });

  afterEach(() => {
    unregister?.();
    unregister = undefined;
    delete process.env.SEC_EXTRACTION_CACHE;
    resetDependencyInjectionsForTesting();
  });

  it("answers an identical second call without reaching the provider", async () => {
    // Two DIFFERENT scripted answers. A second provider call would return the
    // second one, so the assertion distinguishes a cache hit from a coincidence.
    const fake = registerFakeStructuredProvider(
      [
        {
          people: [{ full_name: "Jane Roe", titles: [], confidence: 0.9, source_span: "Jane Roe" }],
        },
        { people: [{ full_name: "SOMEONE ELSE", titles: [], confidence: 0.9, source_span: "x" }] },
      ],
      { allowCache: true }
    );
    unregister = fake.unregister;
    await globalServiceRegistry.get(EXTRACTION_CACHE_REPOSITORY_TOKEN).setupDatabase();

    const first = await extractManagement(SECTION, fakeS1Model());
    const second = await extractManagement(SECTION, fakeS1Model());

    expect(fake.calls).toHaveLength(1);
    expect(first.map((p) => p.full_name)).toEqual(["Jane Roe"]);
    expect(second.map((p) => p.full_name)).toEqual(["Jane Roe"]);
    expect(await globalServiceRegistry.get(EXTRACTION_CACHE_REPOSITORY_TOKEN).size()).toBe(1);
  });

  it("still calls the provider for a different section", async () => {
    const fake = registerFakeStructuredProvider(
      [
        {
          people: [{ full_name: "Jane Roe", titles: [], confidence: 0.9, source_span: "Jane Roe" }],
        },
        {
          people: [{ full_name: "John Doe", titles: [], confidence: 0.9, source_span: "John Doe" }],
        },
      ],
      { allowCache: true }
    );
    unregister = fake.unregister;
    await globalServiceRegistry.get(EXTRACTION_CACHE_REPOSITORY_TOKEN).setupDatabase();

    await extractManagement(SECTION, fakeS1Model());
    const second = await extractManagement(`${SECTION} And another paragraph.`, fakeS1Model());

    expect(fake.calls).toHaveLength(2);
    expect(second.map((p) => p.full_name)).toEqual(["John Doe"]);
  });

  it("reaches the provider every time when the cache is off", async () => {
    process.env.SEC_EXTRACTION_CACHE = "0";
    const fake = registerFakeStructuredProvider(
      [
        {
          people: [{ full_name: "Jane Roe", titles: [], confidence: 0.9, source_span: "Jane Roe" }],
        },
        {
          people: [{ full_name: "John Doe", titles: [], confidence: 0.9, source_span: "John Doe" }],
        },
      ],
      { allowCache: true }
    );
    unregister = fake.unregister;
    await globalServiceRegistry.get(EXTRACTION_CACHE_REPOSITORY_TOKEN).setupDatabase();

    await extractManagement(SECTION, fakeS1Model());
    const second = await extractManagement(SECTION, fakeS1Model());

    expect(fake.calls).toHaveLength(2);
    expect(second.map((p) => p.full_name)).toEqual(["John Doe"]);
    // And nothing was left behind for a later run to be served from.
    expect(await globalServiceRegistry.get(EXTRACTION_CACHE_REPOSITORY_TOKEN).size()).toBe(0);
  });

  it("does not remember a call that failed validation", async () => {
    // A rejected object must never be served to a later filing as though it had
    // passed. `people` is required by the schema, so this fails every attempt.
    const fake = registerFakeStructuredProvider([{ wrong: true }], { allowCache: true });
    unregister = fake.unregister;
    await globalServiceRegistry.get(EXTRACTION_CACHE_REPOSITORY_TOKEN).setupDatabase();

    await expect(extractManagement(SECTION, fakeS1Model())).rejects.toThrow();
    expect(await globalServiceRegistry.get(EXTRACTION_CACHE_REPOSITORY_TOKEN).size()).toBe(0);
  });
});
