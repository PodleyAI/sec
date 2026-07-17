/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { SEC_JSON_OUTPUT } from "../config/tokens";

/**
 * True when the global `--json` flag was passed, so status/error output should
 * be machine-parseable JSON instead of pretty text. Reads the DI-registered
 * flag, mirroring {@link isDryRun}; defaults to `false` when unregistered (e.g.
 * pure-CLI invocations before the preAction hook runs).
 */
export function isJsonOutput(): boolean {
  return globalServiceRegistry.has(SEC_JSON_OUTPUT) && globalServiceRegistry.get(SEC_JSON_OUTPUT);
}
