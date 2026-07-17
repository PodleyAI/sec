/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, WORKER_MANAGER } from "workglow";

/**
 * Terminate any worker threads spawned by the worker-backed AI providers
 * (HuggingFace Transformers ONNX, node-llama-cpp GGUF). Those workers keep the
 * Node/Bun event loop alive, so without this a CLI invocation that touched a
 * local model would **hang after printing results** — until the provider's
 * factory-worker idle timeout (~15 min) eventually fired. Disposing the
 * WorkerManager terminates them so the process exits promptly.
 *
 * No-op / best-effort when no worker was ever created (e.g. a cloud-only run):
 * disposing an empty manager terminates nothing.
 */
export async function terminateWorkers(): Promise<void> {
  const manager = globalServiceRegistry.get(WORKER_MANAGER);
  await manager?.dispose?.();
}
