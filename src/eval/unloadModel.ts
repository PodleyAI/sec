/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { ModelDownloadRemoveTask } from "workglow";

/**
 * Providers whose weights live in a worker's memory and are safe to release
 * between eval candidates. Restricted to `LOCAL_LLAMACPP`: its `download-remove`
 * run function only disposes the in-memory model/context (it does NOT delete the
 * `.gguf` file), so unloading is cheap to reverse. The HF ONNX provider is left
 * resident — its `download-remove` may evict the on-disk model cache, and its
 * footprint is small enough not to matter for VRAM.
 */
const UNLOADABLE_PROVIDERS = new Set<string>(["LOCAL_LLAMACPP"]);

/**
 * Release a worker-backed local model's in-memory weights and context so a
 * multi-model sweep doesn't accumulate VRAM/RAM across candidates — each gets a
 * clean budget and its latency isn't skewed by co-resident models. No-op for
 * cloud (and other non-unloadable) providers. Best-effort: a model that can't be
 * unloaded must never fail the sweep, so failures are swallowed. The provider
 * also evicts least-recently-used models on a VRAM error, so this is an
 * optimization for clean measurement, not a correctness requirement.
 */
export async function unloadLocalModel(model: ModelConfig): Promise<void> {
  const provider = (model as { provider?: string }).provider;
  if (!provider || !UNLOADABLE_PROVIDERS.has(provider)) return;
  try {
    const input = { model };
    const task = new ModelDownloadRemoveTask({ defaults: input } as any);
    await task.run(input as any);
  } catch {
    // Leave it resident if unload isn't supported / fails; auto-evict covers correctness.
  }
}
