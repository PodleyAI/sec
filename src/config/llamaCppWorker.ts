/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker entry for the node-llama-cpp (GGUF) provider. The native llama.cpp
 * binding (Metal on Apple Silicon) and all task run functions load HERE, in a
 * worker thread — never on the CLI's main thread. `registerProviders` spawns
 * this file via `registerLlamaCpp({ worker })`.
 */

import { registerLlamaCppWorker } from "@workglow/node-llama-cpp/ai-runtime";

await registerLlamaCppWorker();
