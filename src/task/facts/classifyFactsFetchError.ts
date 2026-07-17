/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getHttpErrorStatus,
  isRetryableJobErrorShape,
  NETWORK_ERRNO_PATTERN,
  NETWORK_MESSAGE_PATTERN,
} from "../fetch/SecFetchJob";
import type { FactsReasonCode } from "../../storage/processing/ProcessedFactsSchema";

export type FactsFetchReasonCode = Extract<
  FactsReasonCode,
  "NO_XBRL_FACTS" | "FETCH_ERROR" | "PARSE_ERROR"
>;

/**
 * Classifies an error thrown while fetching/linearizing company facts.
 * A 404 means the entity has no XBRL companyfacts data ({@link FactsReasonCode}
 * `NO_XBRL_FACTS` — terminal, not retryable); other HTTP/network failures are
 * transient `FETCH_ERROR`s; anything else is a code-fixable `PARSE_ERROR`.
 */
export function classifyFactsFetchError(error: unknown): FactsFetchReasonCode {
  const status = getHttpErrorStatus(error);
  if (status === 404) return "NO_XBRL_FACTS";
  if (status !== undefined) return "FETCH_ERROR";

  if (isRetryableJobErrorShape(error)) return "FETCH_ERROR";
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code && NETWORK_ERRNO_PATTERN.test(code)) return "FETCH_ERROR";
  const message = error instanceof Error ? error.message : "";
  if (NETWORK_MESSAGE_PATTERN.test(message)) return "FETCH_ERROR";

  return "PARSE_ERROR";
}
