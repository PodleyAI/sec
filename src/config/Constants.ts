/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SEC fair-access policy requires a User-Agent in the form
 *   "Sample Company Name AdminContact@samplecompany.com"
 * EDGAR has been observed to 403 on RFC-5322 angle-bracket forms.
 * Override at runtime via the SEC_USER_AGENT environment variable so each
 * deployer identifies themselves rather than masquerading as the default.
 */
const DEFAULT_SEC_USER_AGENT = "PodleyAI SEC Job Queue sroussey@gmail.com";
export const SecUserAgent = process.env.SEC_USER_AGENT?.trim() || DEFAULT_SEC_USER_AGENT;
export const SecJobQueueName = "sec_job_queue";

/**
 * Steady-state SEC fetch cap in requests/second, shared across ALL processes
 * via the cluster rate limiter. Held at 8 — deliberately below EDGAR's
 * documented 10 req/s ceiling — so startup bursts and clock skew across shards
 * don't trip a ~10-minute IP block; a real 429 escalates to the cluster
 * cooldown. Override DOWN via SEC_FETCH_MAX_PER_SEC (1–8); the ceiling is
 * clamped to 8 so we stay consistently under EDGAR's limit and a stray higher
 * value can't push us to the edge.
 */
export const SecFetchMaxPerSec = ((): number => {
  const raw = process.env.SEC_FETCH_MAX_PER_SEC?.trim();
  const parsed = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 8;
  return parsed >= 1 && parsed <= 8 ? parsed : 8;
})();

/**
 * Ceiling on SEC fetches IN FLIGHT at once, per process.
 *
 * {@link SecFetchMaxPerSec} caps how many fetches may START each second; it
 * does not cap how many are still running. The queue worker dispatches each
 * claimed job in the background and immediately loops for the next, and the
 * rate limiter's window is pruned by AGE rather than by completion, so a slot
 * frees one second after a fetch begins no matter how long it takes. In-flight
 * work is therefore `rate x latency`: while EDGAR is healthy (sub-second) that
 * is ~8, but a slow spell serving multi-MB full-submission `.txt` documents at
 * 30s each admits ~240 concurrent requests.
 *
 * Each in-flight fetch holds roughly two file descriptors, and the pool only
 * releases them after an idle period, so that pile-up is what exhausts the
 * process's descriptor table — reliably on macOS, whose default `ulimit -n` of
 * 256 is crossed at ~128 concurrent fetches. The failure is not a leak: at a
 * fixed concurrency the descriptor count is flat and returns to baseline once
 * the pool goes idle. It is the unbounded PEAK that has to be capped.
 *
 * 16 is chosen so the cap binds only in the slow case it exists for: at 8
 * starts/second it is not reached until a fetch averages over two seconds, so
 * a healthy sweep runs at exactly the speed it does today, while a degraded
 * EDGAR costs throughput instead of the whole process. Override via
 * SEC_FETCH_MAX_CONCURRENT, clamped to 1..64 — an unclamped override would
 * restore the unbounded behavior this constant exists to prevent, and 64
 * in-flight (~128 descriptors) still fits inside the smallest default limit.
 */
export const SecFetchMaxConcurrent = ((): number => {
  const raw = process.env.SEC_FETCH_MAX_CONCURRENT?.trim();
  const parsed = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 16;
  return Math.min(64, Math.max(1, parsed || 16));
})();

/**
 * Page-cache ceiling, in MEGABYTES, for the one SQLite connection every sec
 * table shares (`getDb()` — `createStorage` hands it to every
 * `SqliteTabularStorage`). Override via SEC_SQLITE_CACHE_MB, clamped to
 * 2..4096.
 *
 * Stated in MB because `PRAGMA cache_size` is stated in PAGES when its
 * argument is positive and in KiB when it is negative, and the two read
 * identically at the call site. The previous `cache_size = 1000000` was the
 * positive form: one million pages at the 4 KiB `page_size` these databases
 * use is a **~4 GB** ceiling on a cache that fills as the sweep touches pages
 * and never shrinks. A long forms sweep therefore looks like a slow leak —
 * RSS climbing for hours while the JS heap stays flat — because the growth is
 * in the pager, not the heap. Measured scanning a 271 MB database: +31 MB RSS
 * at the old setting versus +3 MB at 2 MB of cache, with the gap bounded only
 * by `min(database size, ceiling)`.
 *
 * 256 MB keeps the hot b-tree interior pages of the tables a sweep hammers
 * (`filings`, `extractor_runs`) resident, which is where the cache earns its
 * keep; the leaf pages of a multi-GB scan are read once and evicting them
 * costs nothing. Raise it on a machine with memory to spare.
 *
 * `temp_store = MEMORY` is deliberately left alone: it holds transient sort
 * and temp-index b-trees for the duration of one statement, so it is a
 * per-query peak rather than a monotonically growing cache, and moving it to
 * disk would slow every ORDER BY in the CLI for a bound this pragma does not
 * actually provide.
 */
export const SecSqliteCacheMb = ((): number => {
  const raw = process.env.SEC_SQLITE_CACHE_MB?.trim();
  const parsed = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 256;
  return Math.min(4096, Math.max(2, parsed || 256));
})();

/**
 * General default model id shared by every SEC AI extractor (S-1, merger-proxy,
 * redemption) when its own env override (e.g. SEC_S1_MODEL) is unset. Override
 * for all extractors at once via the SEC_MODEL_DEFAULT environment variable.
 *
 * Each of these variables is a CSV list, not a scalar: the first id is the
 * primary model, and later ids run only when an extract returns no rows
 * (`MODEL_EMPTY`). A single id is still a one-element list. Duplicate and
 * blank entries are dropped. An unset per-extractor variable inherits this
 * whole list; a set override replaces it.
 *
 * The default stays on Anthropic so a deployment holding only
 * ANTHROPIC_API_KEY can resolve it; any other built-in id would turn every
 * AI section into a MODEL_RESOLUTION_ERROR dead letter. A cheaper tier is
 * adopted per deployment through SEC_MODEL_DEFAULT (all extractors) or a
 * per-extractor variable such as SEC_S1_RISK_FACTORS_MODEL, after ranking
 * it with `sec eval s1`. Schema conformance is the provider layer's job
 * (`jsonModeChatParts` in `@workglow/ai`), not a filter on this list.
 */
export const DEFAULT_SEC_MODEL = "claude-sonnet-5";

/** Reserved extract id for the sync section walk. Same string stored as provenance `model_id`. */
export const DETERMINISTIC_MODEL_ID = "deterministic";

/**
 * Split a model env value into distinct ids. A scalar is a one-element list.
 * Empty / unset input falls back to `fallback` as a single id.
 */
export function parseModelIdList(raw: string | undefined, fallback: string): string[] {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return [fallback];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const part of trimmed.split(",")) {
    const id = part.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length === 0 ? [fallback] : ids;
}

/** `SEC_MODEL_DEFAULT` as a list, parsed at call time so tests can mutate env. */
export function defaultModelIds(): string[] {
  return parseModelIdList(process.env.SEC_MODEL_DEFAULT, DEFAULT_SEC_MODEL);
}

/**
 * Per-extractor override: unset inherits {@link defaultModelIds}. A set value
 * (scalar or CSV) replaces the whole list unless `appendDefaultFallbacks` is
 * set — then the override is tried first and any default ids not already in
 * it are appended, so a scalar `SEC_REDEMPTION_MODEL` cannot cut off the
 * shared grok/haiku fallbacks.
 */
export function modelIdsFromEnv(
  override: string | undefined,
  options?: { readonly appendDefaultFallbacks?: boolean }
): string[] {
  const trimmed = (override ?? "").trim();
  const primary = trimmed === "" ? defaultModelIds() : parseModelIdList(trimmed, DEFAULT_SEC_MODEL);
  if (trimmed === "" || options?.appendDefaultFallbacks !== true) return primary;
  const seen = new Set(primary);
  const out = [...primary];
  for (const id of defaultModelIds()) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const parsedDefault = parseModelIdList(process.env.SEC_MODEL_DEFAULT, DEFAULT_SEC_MODEL);
/** First id of {@link defaultModelIds} at module load — the scalar most callers want. */
export const SecModelDefault = parsedDefault[0]!;

/**
 * A local HuggingFace Transformers (ONNX) model, registered alongside the cloud
 * default so it is available for the extraction comparison harness (`sec eval`)
 * without a cloud API key. Override the repo id via `SEC_HFT_MODEL`. The
 * `onnx:` prefix is what routes it to the HFT provider — see `secModelRecord`
 * (a bare `org/name` is ambiguous with OpenRouter / HF Inference paths).
 *
 * This is only the fallback repo id for the HFT provider when `SEC_HFT_MODEL` is
 * unset — it is NOT part of the default `sec eval` sweep (haiku vs sonnet) and is
 * not a production-extraction candidate: small local models hard schema-fail on
 * real S-1 sections and hallucinate entities memorized from pretraining. Rank any
 * local candidate yourself against `sec eval s1 --reference golden` before relying
 * on it. For a stronger but far slower local baseline set
 * `SEC_HFT_MODEL=onnx:onnx-community/Qwen3-4B-Instruct-2507-ONNX`.
 */
const DEFAULT_SEC_HFT_MODEL = "onnx:onnx-community/LFM2.5-350M-ONNX";
export const SecHftModelDefault = process.env.SEC_HFT_MODEL?.trim() || DEFAULT_SEC_HFT_MODEL;
