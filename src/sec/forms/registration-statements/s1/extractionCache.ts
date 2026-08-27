/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A content-addressed cache in front of the extraction model call.
 *
 * A registration is filed once and then restated, so a sweep sends the same
 * section to the same model under the same instructions many times over: across
 * 25 real amendment families, 21% of section-granularity calls are repeats
 * (`scripts/measureSectionReuse.ts`). This answers those from storage.
 *
 * It sits at exactly one seam — {@link runGuardedExtraction} — and nothing
 * downstream can tell the difference: results are still written per accession
 * by the caller, so which filing asserted what, and when, is unchanged by
 * whether a call was answered from here.
 *
 * Sound only because extraction samples greedily (`SEC_EXTRACTION_TEMPERATURE`
 * is 0): the same input already produces the same output, and this makes that
 * cheap rather than making it true.
 */

import { createHash } from "node:crypto";
import { globalServiceRegistry } from "workglow";
import { isDryRun } from "../../../../cli/isDryRun";
import { getExtractionTemperature } from "../../../../config/extractionTemperature";
import {
  EXTRACTION_CACHE_REPOSITORY_TOKEN,
  type ExtractionCacheRepositoryStorage,
} from "../../../../storage/extraction/ExtractionCacheSchema";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Everything that decides what a call returns. */
export interface ExtractionCacheInputs {
  readonly label: string;
  readonly modelId: string | null;
  readonly instructions: string;
  readonly outputSchema: object;
  readonly sectionText: string;
}

export interface ExtractionCacheKey {
  readonly cacheKey: string;
  readonly promptSha256: string;
  readonly sectionSha256: string;
}

/**
 * The key for one call.
 *
 * Each component is hashed separately and the hashes are then hashed together,
 * rather than concatenating the components and hashing once. Concatenation is
 * ambiguous — instructions ending in a word plus a section starting with
 * another is indistinguishable from a different split of the same bytes — and
 * an ambiguity here is a cache that answers one section's question with another
 * section's result.
 *
 * The output schema is part of the key because it is part of the request: the
 * same prompt against a changed schema is a different call, and serving the old
 * answer would return an object the caller's new shape does not fit.
 */
export function extractionCacheKey(inputs: ExtractionCacheInputs): ExtractionCacheKey {
  const promptSha256 = sha256(
    [sha256(inputs.instructions), sha256(JSON.stringify(inputs.outputSchema))].join("")
  );
  const sectionSha256 = sha256(inputs.sectionText);
  return {
    cacheKey: sha256(
      [sha256(inputs.label), sha256(inputs.modelId ?? ""), promptSha256, sectionSha256].join("")
    ),
    promptSha256,
    sectionSha256,
  };
}

/**
 * The cache repository, or undefined when there is none to use.
 *
 * Undefined in three cases, all of which mean "call the model": the kill switch
 * is set, DI has no binding (an eval harness or a unit test that never
 * bootstrapped storage), or the caller is a dry run. A dry run must not WRITE,
 * and reading in one would report a saving the real run has not made.
 */
function cacheRepo(): ExtractionCacheRepositoryStorage | undefined {
  if (!isExtractionCacheEnabled()) return undefined;
  if (!globalServiceRegistry.has(EXTRACTION_CACHE_REPOSITORY_TOKEN)) return undefined;
  return globalServiceRegistry.get(EXTRACTION_CACHE_REPOSITORY_TOKEN);
}

/**
 * Suspends the cache for the duration of a callback.
 *
 * For a stateful test double. The cache assumes the call it fronts is a
 * function of its inputs; a scripted provider that answers a queue is not one,
 * and it legitimately returns a different object for the same section on the
 * second call. Exposed so the double can turn the cache off for its own
 * lifetime, which is where the constraint belongs — a rule each test has to
 * remember is a rule the next test forgets.
 */
let suspended = 0;
export function suspendExtractionCache(): () => void {
  suspended += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suspended -= 1;
  };
}

/**
 * Whether the cache is in play.
 *
 * On by default, off with `SEC_EXTRACTION_CACHE=0`. A kill switch rather than an
 * opt-in because the cache is semantically neutral at temperature 0 and a cache
 * nobody enables saves nothing — but an operator comparing models, or chasing a
 * result they cannot reproduce, needs one flag that takes it out of the picture.
 *
 * Off automatically whenever sampling is NOT greedy. The whole soundness
 * argument is that temperature 0 already makes the same input produce the same
 * output; above 0 the second call would legitimately differ, and serving the
 * first would quietly re-impose the determinism the operator just asked to
 * lift. This is the one place that can enforce it, so it does rather than
 * warning about it in a comment.
 */
export function isExtractionCacheEnabled(): boolean {
  if (suspended > 0) return false;
  const raw = (process.env.SEC_EXTRACTION_CACHE ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  // Undefined means the caller asked for the parameter to be omitted entirely,
  // which is the provider's default — not known to be greedy.
  if (getExtractionTemperature() !== 0) return false;
  // A dry run reports what a real run WOULD do; serving it from cache would
  // report a saving that has not happened yet.
  return !isDryRun();
}

/**
 * A previously validated result for this exact call, or undefined.
 *
 * Never throws. A cache that can fail the extraction it is accelerating is
 * worse than no cache, so a storage error, an unreadable row or malformed JSON
 * all fall through to calling the model.
 */
export async function readExtractionCache(
  key: ExtractionCacheKey
): Promise<Record<string, unknown> | undefined> {
  const repo = cacheRepo();
  if (repo === undefined) return undefined;
  try {
    const row = await repo.get({ cache_key: key.cacheKey });
    if (row === undefined) return undefined;
    const parsed = JSON.parse(row.result) as unknown;
    // A JSON scalar or array is not an extraction result. Treated as a miss
    // rather than returned, since every caller indexes into an object.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Remember a validated result.
 *
 * Only ever called with an object that passed schema validation and, where one
 * was in play, the nonce check — a rejected or unverified object must never be
 * served to a later filing as though it had passed.
 *
 * Never throws, for the same reason as the read.
 */
export async function writeExtractionCache(
  key: ExtractionCacheKey,
  inputs: ExtractionCacheInputs,
  result: Record<string, unknown>
): Promise<void> {
  const repo = cacheRepo();
  if (repo === undefined) return;
  try {
    await repo.put({
      cache_key: key.cacheKey,
      label: inputs.label.slice(0, 64),
      model_id: (inputs.modelId ?? "").slice(0, 128),
      prompt_sha256: key.promptSha256,
      section_sha256: key.sectionSha256,
      section_chars: inputs.sectionText.length,
      result: JSON.stringify(result),
      created_at: new Date().toISOString(),
    });
  } catch {
    // A cache that cannot be written is a cache that misses next time, which is
    // the behaviour without it. Not worth failing a successful extraction over.
  }
}
