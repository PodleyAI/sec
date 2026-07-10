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
 * General default model id shared by every SEC AI extractor (S-1, merger-proxy,
 * redemption) when its own env override (e.g. SEC_S1_MODEL) is unset. Override
 * for all extractors at once via the SEC_MODEL_DEFAULT environment variable.
 */
const DEFAULT_SEC_MODEL = "claude-sonnet-5";
export const SecModelDefault = process.env.SEC_MODEL_DEFAULT?.trim() || DEFAULT_SEC_MODEL;

/**
 * A local HuggingFace Transformers (ONNX) model, registered alongside the cloud
 * default so it is available for the extraction comparison harness (`sec eval`)
 * without a cloud API key. Override the repo id via `SEC_HFT_MODEL`. Its `/`
 * (HuggingFace `org/name` form) is what routes it to the HFT provider rather
 * than Anthropic — see `secModelRecord`.
 *
 * Defaults to LiquidAI's LFM2.5-350M — an edge-optimized model that, on the
 * management fixtures, reaches ~100% entity recall with valid schema in seconds
 * per call. It beats much larger models on this box on every axis: it is far
 * more accurate than Qwen2.5-0.5B/1.5B and ~50x faster than Qwen3-4B (which
 * matches its quality but costs minutes per call on CPU). For a stronger but
 * far slower local baseline set
 * `SEC_HFT_MODEL=onnx-community/Qwen3-4B-Instruct-2507-ONNX`.
 */
const DEFAULT_SEC_HFT_MODEL = "onnx-community/LFM2.5-350M-ONNX";
export const SecHftModelDefault = process.env.SEC_HFT_MODEL?.trim() || DEFAULT_SEC_HFT_MODEL;
