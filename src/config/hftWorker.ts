/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker entry for the HuggingFace Transformers (ONNX) provider. The heavy
 * `@huggingface/transformers` graph and all task run functions load HERE, in a
 * worker thread — never on the CLI's main thread. `registerProviders` spawns
 * this file via `registerHuggingFaceTransformers({ worker })`.
 */

import {
  registerHuggingFaceTransformersWorker,
  setHftCacheDir,
} from "@workglow/huggingface-transformers/ai-runtime";

if (process.env.WORKGLOW_MODEL_CACHE) {
  setHftCacheDir(process.env.WORKGLOW_MODEL_CACHE);
}

await registerHuggingFaceTransformersWorker();
