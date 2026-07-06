/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ModelConfig,
} from "workglow";
import { AiProvider, getAiProviderRegistry } from "workglow";

const JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];
const FAKE_PROVIDER = "fake-structured";

class FakeStructuredProvider extends AiProvider {
  override readonly name = FAKE_PROVIDER;
  override readonly displayName = "Fake Structured";
  override readonly isLocal = true;
  override readonly supportsBrowser = false;
  override readonly supportsServer = false;

  constructor(runFns?: readonly AiProviderRunFnRegistration<any, any, ModelConfig>[]) {
    super(runFns);
  }
}

export function fakeS1Model(): ModelConfig {
  return {
    provider: FAKE_PROVIDER,
    model: "fake-s1-model",
    capabilities: JSON_MODE,
    provider_config: {},
  } as ModelConfig;
}

/**
 * Matches the untrusted-fence opening tag's nonce (see sectionExtractors.ts
 * wrapUntrusted / extractFenceNonce in sectionExtractors.injection.test.ts).
 */
const NONCE_RE = /<UNTRUSTED_FILER_DOCUMENT_NONCE_([0-9a-f]{16})>/;

/** True when `schema` is a JSON Schema object declaring a `nonce_seen` property. */
function schemaWantsNonceSeen(schema: unknown): boolean {
  if (schema === null || typeof schema !== "object") return false;
  const properties = (schema as { properties?: unknown }).properties;
  return properties !== null && typeof properties === "object" && "nonce_seen" in properties;
}

/**
 * Registers a fake json-mode provider that returns scripted payloads, one per
 * prompt invocation. Each payload is emitted as an object-delta and a finish
 * event whose `data.object` carries the full object (json-mode convention).
 *
 * Auto-echoes the untrusted-fence nonce into `nonce_seen` (extracted from the
 * prompt) whenever the call's outputSchema declares that property AND the
 * caller's canned payload doesn't already set `nonce_seen` explicitly. Only
 * three of the ~10 section schemas require nonce_seen (Management,
 * MergerDeal, Redemption); the schema check keeps this from injecting an
 * `additionalProperties: false`-rejected field into every other extractor's
 * payload. The "already set" escape hatch lets red-team tests supply a wrong
 * value to exercise NonceMismatchError, while every other call site (the
 * ~90 existing fixtures that predate the nonce echo-back requirement) passes
 * unmodified.
 */
export function registerFakeStructuredProvider(attempts: ReadonlyArray<Record<string, unknown>>): {
  calls: ReadonlyArray<string>;
  unregister: () => void;
} {
  const calls: string[] = [];
  let index = 0;
  const runFn: AiProviderRunFn<any, any, ModelConfig> = async (
    input,
    _model,
    _signal,
    emit,
    outputSchema
  ) => {
    const prompt = input.prompt as string;
    calls.push(prompt);
    const attempt = attempts[Math.min(index, attempts.length - 1)];
    index++;
    const nonceMatch = prompt.match(NONCE_RE);
    const payload =
      nonceMatch !== null && schemaWantsNonceSeen(outputSchema) && !("nonce_seen" in attempt)
        ? { ...attempt, nonce_seen: nonceMatch[1] }
        : attempt;
    emit({ type: "object-delta", port: "object", objectDelta: payload });
    emit({ type: "finish", data: { object: payload } as any });
  };

  const registry = getAiProviderRegistry();
  registry.registerProvider(new FakeStructuredProvider([{ serves: JSON_MODE, runFn }]));
  registry.registerRunFn(FAKE_PROVIDER, { serves: JSON_MODE, runFn });
  return { calls, unregister: () => registry.unregisterProvider(FAKE_PROVIDER) };
}
