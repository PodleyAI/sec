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
 * General default model id shared by every SEC AI extractor (S-1, merger-proxy,
 * redemption) when its own env override (e.g. SEC_S1_MODEL) is unset. Override
 * for all extractors at once via the SEC_MODEL_DEFAULT environment variable.
 */
const DEFAULT_SEC_MODEL = "deepseek-v4-flash";
export const SecModelDefault = process.env.SEC_MODEL_DEFAULT?.trim() || DEFAULT_SEC_MODEL;

/**
 * A local HuggingFace Transformers (ONNX) model, registered alongside the cloud
 * default so it is available for the extraction comparison harness (`sec eval`)
 * without a cloud API key. Override the repo id via `SEC_HFT_MODEL`. Its `/`
 * (HuggingFace `org/name` form) is what routes it to the HFT provider rather
 * than Anthropic — see `secModelRecord`.
 *
 * This is only the fallback repo id for the HFT provider when `SEC_HFT_MODEL` is
 * unset — it is NOT part of the default `sec eval` sweep (haiku vs sonnet) and is
 * not a production-extraction candidate: small local models hard schema-fail on
 * real S-1 sections and hallucinate entities memorized from pretraining. Rank any
 * local candidate yourself against `sec eval s1 --reference golden` before relying
 * on it. For a stronger but far slower local baseline set
 * `SEC_HFT_MODEL=onnx-community/Qwen3-4B-Instruct-2507-ONNX`.
 */
const DEFAULT_SEC_HFT_MODEL = "onnx-community/LFM2.5-350M-ONNX";
export const SecHftModelDefault = process.env.SEC_HFT_MODEL?.trim() || DEFAULT_SEC_HFT_MODEL;
