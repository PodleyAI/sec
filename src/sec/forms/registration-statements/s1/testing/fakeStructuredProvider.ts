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
 * Registers a fake json-mode provider that returns scripted payloads, one per
 * prompt invocation. Each payload is emitted as an object-delta and a finish
 * event whose `data.object` carries the full object (json-mode convention).
 */
export function registerFakeStructuredProvider(attempts: ReadonlyArray<Record<string, unknown>>): {
  calls: ReadonlyArray<string>;
  unregister: () => void;
} {
  const calls: string[] = [];
  let index = 0;
  const runFn: AiProviderRunFn<any, any, ModelConfig> = async (input, _model, _signal, emit) => {
    calls.push(input.prompt as string);
    const payload = attempts[Math.min(index, attempts.length - 1)];
    index++;
    emit({ type: "object-delta", port: "object", objectDelta: payload });
    emit({ type: "finish", data: { object: payload } as any });
  };

  const registry = getAiProviderRegistry();
  registry.registerProvider(new FakeStructuredProvider([{ serves: JSON_MODE, runFn }]));
  registry.registerRunFn(FAKE_PROVIDER, { serves: JSON_MODE, runFn });
  return { calls, unregister: () => registry.unregisterProvider(FAKE_PROVIDER) };
}
