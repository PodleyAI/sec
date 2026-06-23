/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { getGlobalModelRepository } from "workglow";
import { resolveModelId } from "./s1Model";

export { resolveModelId };

const DEFAULT_MERGER_PROXY_MODEL = "claude-sonnet-4-6";

/** The model id used for merger-proxy extraction; overridable via SEC_MERGER_PROXY_MODEL. */
export function getMergerProxyModelId(): string {
  const id = (process.env.SEC_MERGER_PROXY_MODEL ?? "").trim();
  return id === "" ? DEFAULT_MERGER_PROXY_MODEL : id;
}

/** Resolves the configured merger-proxy model into a ModelConfig. */
export async function getMergerProxyModel(): Promise<ModelConfig> {
  const id = getMergerProxyModelId();
  const record = await getGlobalModelRepository().findByName(id);
  if (!record) {
    throw new Error(
      `Merger-proxy model '${id}' is not registered. Register it or set SEC_MERGER_PROXY_MODEL to a known model id.`
    );
  }
  return record as ModelConfig;
}
