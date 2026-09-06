/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SecCliConfigurationError } from "./EnvToDI";

/**
 * The two model roles this CLI has.
 *
 * `sec ask` embeds filing sections and then answers from what it retrieves.
 * There is no third role, and no per-command override matrix: the extraction
 * pipeline that needed one lives elsewhere now.
 */

/**
 * Embeddings, local by default.
 *
 * A demo that requires a credit card before it prints anything is not a demo,
 * so the default runs on the machine: `bge-base-en-v1.5` through
 * `@workglow/huggingface-transformers`, quantized, no key. The weights are
 * downloaded once into `SEC_RAW_DATA_FOLDER/onnx-cache` and reused.
 */
const DEFAULT_EMBEDDING_MODEL = "onnx:Xenova/bge-base-en-v1.5:q8";

/**
 * The embedding model's output width.
 *
 * A schema fact, not a preference: the vector column is created at this width
 * and every stored vector has it. Changing the model without re-indexing
 * produces a store whose vectors mean nothing to the query, so the index
 * records the model and width it was built with (`kb_index`) and
 * `getSecKnowledgeBase()` refuses to open it under a different one rather than
 * returning plausible nonsense.
 */
export const SEC_EMBEDDING_DIMENSIONS = 768;

/** The embedding model id, overridable with `SEC_EMBEDDING_MODEL`. */
export function secEmbeddingModel(): string {
  return process.env.SEC_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

/** Cloud generation models, in the order a key is looked for. */
const CLOUD_GENERATION: readonly { readonly env: string; readonly model: string }[] = [
  { env: "ANTHROPIC_API_KEY", model: "claude-sonnet-5" },
  { env: "OPENAI_API_KEY", model: "gpt-5" },
  { env: "GEMINI_API_KEY", model: "gemini-2.5-pro" },
];

/**
 * A local generation model, so `ask` answers with no key at all.
 *
 * Small, and it shows: retrieval-grounded answering is a far easier task than
 * schema-constrained extraction, but the key-less experience is visibly worse
 * than the cloud one. `ask` prints which model answered, so a disappointing
 * answer is attributable rather than mysterious.
 */
const DEFAULT_LOCAL_GENERATION = "onnx:onnx-community/LFM2.5-350M-ONNX";

export interface ResolvedModel {
  readonly modelId: string;
  /** One clause saying why this one, for the line printed under an answer. */
  readonly reason: string;
}

/**
 * The generation model, and why.
 *
 * `SEC_MODEL` wins outright. Otherwise the first cloud provider whose key is in
 * the environment, and failing that the local model — which always resolves, so
 * this function does not throw. What it will not do is silently pick a cloud
 * model whose key is absent: that fails later, inside a task, as an error about
 * a provider rather than about configuration.
 */
export function secGenerationModel(): ResolvedModel {
  const override = process.env.SEC_MODEL?.trim();
  if (override) return { modelId: override, reason: "SEC_MODEL" };
  for (const candidate of CLOUD_GENERATION) {
    if (process.env[candidate.env]?.trim()) {
      return { modelId: candidate.model, reason: `${candidate.env} is set` };
    }
  }
  return { modelId: DEFAULT_LOCAL_GENERATION, reason: "no API key found — running locally" };
}

/**
 * Every model id this CLI registers: the two roles, deduplicated.
 */
export function secModelIds(): readonly string[] {
  return [...new Set([secEmbeddingModel(), secGenerationModel().modelId])];
}

/** The provider keys present, for the message when a cloud id resolves nothing. */
export function describeMissingKeyFor(modelId: string): string {
  const names = CLOUD_GENERATION.map((candidate) => candidate.env).join(", ");
  throw new SecCliConfigurationError(
    `No provider is registered for model "${modelId}". Set one of ${names}, ` +
      `or unset SEC_MODEL to fall back to the local model.`
  );
}
