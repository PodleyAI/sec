/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../../config/TestingDI";
import { EXTRACTION_CACHE_REPOSITORY_TOKEN } from "../../../../storage/extraction/ExtractionCacheSchema";
import {
  extractionCacheKey,
  isExtractionCacheEnabled,
  readExtractionCache,
  suspendExtractionCache,
  writeExtractionCache,
} from "./extractionCache";

const INPUTS = {
  label: "management",
  modelId: "claude-x",
  instructions: "Extract every director.",
  outputSchema: { type: "object", properties: { people: { type: "array" } } },
  sectionText: "Jane Roe has served as our Chief Executive Officer since 2021.",
};

describe("extractionCacheKey", () => {
  it("is stable for the same call", () => {
    expect(extractionCacheKey(INPUTS).cacheKey).toBe(extractionCacheKey(INPUTS).cacheKey);
  });

  it("changes when any input to the call changes", () => {
    const base = extractionCacheKey(INPUTS).cacheKey;
    const variants = [
      { ...INPUTS, label: "beneficial-ownership" },
      { ...INPUTS, modelId: "claude-y" },
      { ...INPUTS, instructions: "Extract every officer." },
      { ...INPUTS, outputSchema: { type: "object", properties: {} } },
      { ...INPUTS, sectionText: `${INPUTS.sectionText} ` },
    ];
    for (const variant of variants) {
      expect(extractionCacheKey(variant).cacheKey, JSON.stringify(variant.label)).not.toBe(base);
    }
    // Five distinct inputs, five distinct keys — no pair collides either.
    expect(new Set(variants.map((v) => extractionCacheKey(v).cacheKey)).size).toBe(5);
  });

  it("cannot be confused by moving bytes between components", () => {
    // Concatenating the components before hashing would make these two the
    // same call: one section's question answered with another's result.
    const a = extractionCacheKey({ ...INPUTS, instructions: "AB", sectionText: "CD" });
    const b = extractionCacheKey({ ...INPUTS, instructions: "A", sectionText: "BCD" });
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });

  it("distinguishes texts that differ only in whitespace", () => {
    // Raw, not normalized: a stored `source_span` asserts a verbatim passage was
    // found in THIS text, and that stops holding the moment two texts are
    // merely similar.
    const a = extractionCacheKey({ ...INPUTS, sectionText: "a  b" });
    const b = extractionCacheKey({ ...INPUTS, sectionText: "a b" });
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });
});

describe("readExtractionCache / writeExtractionCache", () => {
  beforeEach(async () => {
    // Binds every table in the registry to an in-memory storage.
    resetDependencyInjectionsForTesting();
    await globalServiceRegistry.get(EXTRACTION_CACHE_REPOSITORY_TOKEN).setupDatabase();
    delete process.env.SEC_EXTRACTION_CACHE;
  });

  afterEach(() => {
    delete process.env.SEC_EXTRACTION_CACHE;
    delete process.env.SEC_EXTRACTION_TEMPERATURE;
    resetDependencyInjectionsForTesting();
  });

  it("misses, then hits after a write", async () => {
    const key = extractionCacheKey(INPUTS);
    expect(await readExtractionCache(key)).toBeUndefined();
    await writeExtractionCache(key, INPUTS, { people: [{ full_name: "Jane Roe" }] });
    expect(await readExtractionCache(key)).toEqual({ people: [{ full_name: "Jane Roe" }] });
  });

  it("does not serve one call's result to another", async () => {
    const key = extractionCacheKey(INPUTS);
    await writeExtractionCache(key, INPUTS, { people: [] });
    const other = extractionCacheKey({ ...INPUTS, sectionText: "Someone else entirely." });
    expect(await readExtractionCache(other)).toBeUndefined();
  });

  it("records the components a reader would want to see", async () => {
    const key = extractionCacheKey(INPUTS);
    await writeExtractionCache(key, INPUTS, { people: [] });
    const row = await globalServiceRegistry
      .get(EXTRACTION_CACHE_REPOSITORY_TOKEN)
      .get({ cache_key: key.cacheKey });
    expect(row?.label).toBe("management");
    expect(row?.model_id).toBe("claude-x");
    expect(row?.section_chars).toBe(INPUTS.sectionText.length);
    expect(row?.section_sha256).toBe(key.sectionSha256);
  });

  it("is off when the kill switch is set, in both directions", async () => {
    const key = extractionCacheKey(INPUTS);
    await writeExtractionCache(key, INPUTS, { people: [] });

    process.env.SEC_EXTRACTION_CACHE = "0";
    expect(isExtractionCacheEnabled()).toBe(false);
    // Reads stop being served...
    expect(await readExtractionCache(key)).toBeUndefined();
    // ...and writes stop landing, so a run with it off leaves nothing behind.
    const other = extractionCacheKey({ ...INPUTS, label: "other" });
    await writeExtractionCache(other, { ...INPUTS, label: "other" }, { people: [] });
    process.env.SEC_EXTRACTION_CACHE = "1";
    expect(await readExtractionCache(other)).toBeUndefined();
  });

  it("stands down whenever sampling is not greedy", async () => {
    // The whole soundness argument is that temperature 0 already makes the same
    // input produce the same output. Above 0 the second call would legitimately
    // differ, and serving the first would re-impose the determinism the
    // operator just asked to lift.
    const key = extractionCacheKey(INPUTS);
    await writeExtractionCache(key, INPUTS, { people: [] });

    process.env.SEC_EXTRACTION_TEMPERATURE = "0.7";
    expect(isExtractionCacheEnabled()).toBe(false);
    expect(await readExtractionCache(key)).toBeUndefined();

    // An empty value omits the parameter entirely, which is the provider's
    // default — not known to be greedy, so not cacheable either.
    process.env.SEC_EXTRACTION_TEMPERATURE = "";
    expect(isExtractionCacheEnabled()).toBe(false);

    process.env.SEC_EXTRACTION_TEMPERATURE = "0";
    expect(isExtractionCacheEnabled()).toBe(true);
    expect(await readExtractionCache(key)).toEqual({ people: [] });
  });

  it("can be suspended and restored around a stateful caller", async () => {
    const key = extractionCacheKey(INPUTS);
    await writeExtractionCache(key, INPUTS, { people: [] });

    const resume = suspendExtractionCache();
    expect(await readExtractionCache(key)).toBeUndefined();
    resume();
    expect(await readExtractionCache(key)).toEqual({ people: [] });

    // Releasing twice must not leave the cache suspended for everyone else.
    const resumeAgain = suspendExtractionCache();
    resumeAgain();
    resumeAgain();
    expect(isExtractionCacheEnabled()).toBe(true);
  });

  it("nests suspensions, so an inner release does not re-enable it", async () => {
    const outer = suspendExtractionCache();
    const inner = suspendExtractionCache();
    inner();
    expect(isExtractionCacheEnabled()).toBe(false);
    outer();
    expect(isExtractionCacheEnabled()).toBe(true);
  });

  it("treats a stored non-object as a miss rather than returning it", async () => {
    const key = extractionCacheKey(INPUTS);
    await globalServiceRegistry.get(EXTRACTION_CACHE_REPOSITORY_TOKEN).put({
      cache_key: key.cacheKey,
      label: "management",
      model_id: "claude-x",
      prompt_sha256: key.promptSha256,
      section_sha256: key.sectionSha256,
      section_chars: 1,
      // Every caller indexes into an object; an array would fail far from here.
      result: "[1,2,3]",
      created_at: new Date().toISOString(),
    });
    expect(await readExtractionCache(key)).toBeUndefined();
  });

  it("treats unparseable JSON as a miss rather than throwing", async () => {
    // A cache that can fail the extraction it is accelerating is worse than none.
    const key = extractionCacheKey(INPUTS);
    await globalServiceRegistry.get(EXTRACTION_CACHE_REPOSITORY_TOKEN).put({
      cache_key: key.cacheKey,
      label: "management",
      model_id: "claude-x",
      prompt_sha256: key.promptSha256,
      section_sha256: key.sectionSha256,
      section_chars: 1,
      result: "{ not json",
      created_at: new Date().toISOString(),
    });
    expect(await readExtractionCache(key)).toBeUndefined();
  });

  it("is a no-op with no storage bound, rather than a crash", async () => {
    // An eval harness or a unit test that never bootstrapped storage: the cache
    // has to stand down, not take the extraction with it.
    globalServiceRegistry.container.remove(EXTRACTION_CACHE_REPOSITORY_TOKEN.id);
    const key = extractionCacheKey(INPUTS);
    await expect(writeExtractionCache(key, INPUTS, { people: [] })).resolves.toBeUndefined();
    expect(await readExtractionCache(key)).toBeUndefined();
  });
});
