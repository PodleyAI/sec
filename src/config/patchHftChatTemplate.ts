/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PreTrainedTokenizer } from "@huggingface/transformers";

/**
 * Regex + replacement mirroring the `{% generation %}` strip that
 * `@huggingface/jinja` added after 0.5.6 (see huggingface/transformers#30650).
 * `{%- generation -%}` / `{%- endgeneration -%}` mark the assistant-response
 * span for token-masking during *training* and are inert for inference
 * rendering, so removing them (honoring `{%-`/`-%}` whitespace control) is
 * semantically safe.
 */
const GENERATION_TAG = /(\s*){%(-?)\s*(?:end)?generation\s*(-?)%}(\s*)/gs;

/** Remove `{% generation %}` / `{% endgeneration %}` marker tags from a chat template. */
export function stripGenerationTags(template: string): string {
  return template.replace(GENERATION_TAG, (_m, before, lstrip, rstrip, after) =>
    (lstrip ? "" : before) + (rstrip ? "" : after)
  );
}

let patched = false;

/**
 * Work around transformers.js 4.2.0 bundling jinja **0.5.6**, which predates the
 * `{% generation %}` template strip. Newer chat templates (e.g. LiquidAI's LFM2.5
 * family) use `{%- generation -%}` markers, so their `apply_chat_template` throws
 * `Unknown statement type: generation` and the model can't run. We wrap the
 * tokenizer's `get_chat_template` — which `apply_chat_template` calls right before
 * `new Template(...)` — to strip those markers first. Idempotent; safe for
 * templates that don't use the markers (no-op).
 *
 * Remove once the provider's transformers.js bundles a jinja with the strip.
 */
export function patchHftChatTemplateGenerationTags(): void {
  if (patched) return;
  patched = true;
  const proto = PreTrainedTokenizer.prototype as unknown as {
    get_chat_template: (opts?: unknown) => unknown;
  };
  const original = proto.get_chat_template;
  proto.get_chat_template = function patchedGetChatTemplate(this: unknown, opts?: unknown): unknown {
    const template = original.call(this, opts);
    return typeof template === "string" ? stripGenerationTags(template) : template;
  };
}
