/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FactsReasonCode } from "../../storage/processing/ProcessedFactsSchema";
import {
  getHttpErrorStatus,
  isRetryableJobErrorShape,
  NETWORK_ERRNO_PATTERN,
  NETWORK_MESSAGE_PATTERN,
} from "../fetch/SecFetchJob";
import { isNoXbrlFactsError } from "./NoXbrlFactsError";

export type FactsFetchReasonCode = Extract<
  FactsReasonCode,
  "NO_XBRL_FACTS" | "FETCH_ERROR" | "PARSE_ERROR"
>;

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
}

/**
 * Classifies an error thrown while fetching/linearizing company facts.
 * A 404 — or a 200 whose body carries no `facts` object, which is how
 * data.sec.gov answers for a filer with no XBRL — means the entity has no XBRL
 * companyfacts data ({@link FactsReasonCode} `NO_XBRL_FACTS` — terminal, not
 * retryable); other HTTP/network failures are transient `FETCH_ERROR`s;
 * anything else is a code-fixable `PARSE_ERROR`.
 */
export function classifyFactsFetchError(error: unknown): FactsFetchReasonCode {
  // Checked before the status probes: the "no facts" response is a 200, so
  // nothing downstream would distinguish it from a genuine parse failure.
  if (isNoXbrlFactsError(error)) return "NO_XBRL_FACTS";

  const status = getHttpErrorStatus(error);
  if (status === 404) return "NO_XBRL_FACTS";
  if (status !== undefined) return "FETCH_ERROR";

  if (isRetryableJobErrorShape(error)) return "FETCH_ERROR";
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code && NETWORK_ERRNO_PATTERN.test(code)) return "FETCH_ERROR";
  // Read the message off any error-shaped value, not just `instanceof Error`:
  // the job layer hands back plain objects across module boundaries, and a DNS
  // failure carries its errno only in the message text (see
  // NETWORK_MESSAGE_PATTERN). The wrapper's own message may be generic, so the
  // wrapped `jobError`'s message counts too.
  const message = `${errorMessage(error)}\n${errorMessage(
    (error as { jobError?: unknown } | null)?.jobError
  )}`;
  if (NETWORK_MESSAGE_PATTERN.test(message)) return "FETCH_ERROR";

  return "PARSE_ERROR";
}
