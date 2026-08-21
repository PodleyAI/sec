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
import { deterministicModelConfig } from "../s1Model";

const JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];
const FAKE_PROVIDER = "fake-structured";

class FakeStructuredProvider extends AiProvider {
  override readonly name: string;
  override readonly displayName = "Fake Structured";
  override readonly isLocal = true;
  override readonly supportsBrowser = false;
  override readonly supportsServer = false;

  constructor(
    providerName: string,
    runFns?: readonly AiProviderRunFnRegistration<any, any, ModelConfig>[]
  ) {
    super(runFns);
    this.name = providerName;
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

/** Walk first, then the fake AI model — today's production wrap, opt-in for tests. */
export function s1ModelsWithWalk(ai: ModelConfig = fakeS1Model()): ModelConfig[] {
  return [deterministicModelConfig(), ai];
}

/**
 * A model on a *local* provider (node-llama-cpp GBNF). The section extractors
 * omit the per-call nonce for local providers ({@link isLocalProvider}), so
 * this is the config to drive the "no-nonce" path. Register the fake provider
 * under the same name via {@link registerFakeStructuredProvider}'s `provider`
 * option so the run routes here.
 */
export function fakeLocalS1Model(): ModelConfig {
  return {
    provider: "LOCAL_LLAMACPP",
    model: "fake-local-s1-model",
    capabilities: JSON_MODE,
    provider_config: {},
  } as ModelConfig;
}

/**
 * Scans the prompt for the verification token planted by
 * `buildUntrustedPreamble`. The token lives in the trusted preamble prose
 * (`"Copy the verification token '<16-hex>' verbatim into nonce_seen"`) and
 * NEVER appears inside the fenced untrusted body — that quarantine is exactly
 * what {@link verifyNonce} relies on. Returns `null` when the prompt does not
 * carry the shape (older callers that predate the token).
 */
const NONCE_RE = /verification token '([0-9a-f]{16})'/;

export function extractVerifyNonce(prompt: string): string | null {
  const m = prompt.match(NONCE_RE);
  return m ? m[1] : null;
}

/**
 * Registers a fake json-mode provider that returns scripted payloads, one per
 * prompt invocation. Each payload is emitted as an object-delta and a finish
 * event whose `data.object` carries the full object (json-mode convention).
 *
 * The provider auto-echoes the trusted-preamble verification token into
 * `nonce_seen` when the canned payload doesn't already set it, so existing
 * fixture-driven tests keep passing without every test having to plant the
 * shared secret manually. Tests that want to model a wrong-nonce attack set
 * `nonce_seen` on the canned payload themselves — that "already set" branch
 * is the escape hatch.
 */
export function registerFakeStructuredProvider(
  attempts: ReadonlyArray<Record<string, unknown> | Error>,
  options?: { readonly provider?: string }
): {
  calls: ReadonlyArray<string>;
  unregister: () => void;
} {
  const providerName = options?.provider ?? FAKE_PROVIDER;
  const calls: string[] = [];
  let index = 0;
  const runFn: AiProviderRunFn<any, any, ModelConfig> = async (input, _model, _signal, emit) => {
    const prompt = input.prompt as string;
    calls.push(prompt);
    const canned = attempts[Math.min(index, attempts.length - 1)];
    index++;
    // A canned Error is thrown rather than returned, so tests can drive the
    // provider-failure paths (throttling, transport errors) as well as the
    // bad-payload ones.
    if (canned instanceof Error) throw canned;
    const nonce = extractVerifyNonce(prompt);
    const payload: Record<string, unknown> =
      nonce !== null && !("nonce_seen" in canned)
        ? { ...canned, nonce_seen: nonce }
        : { ...canned };
    emit({ type: "object-delta", port: "object", objectDelta: payload });
    emit({ type: "finish", data: { object: payload } as any });
  };

  const registry = getAiProviderRegistry();
  registry.registerProvider(
    new FakeStructuredProvider(providerName, [{ serves: JSON_MODE, runFn }])
  );
  registry.registerRunFn(providerName, { serves: JSON_MODE, runFn });
  return { calls, unregister: () => registry.unregisterProvider(providerName) };
}
