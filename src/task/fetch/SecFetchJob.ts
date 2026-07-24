/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FetchUrlJob,
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  IJobExecuteContext,
  JobConstructorParam,
} from "workglow";
import { SecUserAgent } from "../../config/Constants";
import { signalSecFetchThrottle } from "./secFetchThrottle";

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Retry/timeout knobs are tunable via env so deployers can tighten or loosen
// behaviour without a rebuild. Invalid values fall back to the defaults.
const MAX_FETCH_ATTEMPTS = readPositiveIntEnv("SEC_FETCH_MAX_ATTEMPTS", 4);
const INITIAL_BACKOFF_MS = readPositiveIntEnv("SEC_FETCH_INITIAL_BACKOFF_MS", 1_000);
const MAX_BACKOFF_MS = readPositiveIntEnv("SEC_FETCH_MAX_BACKOFF_MS", 30_000);
const DEFAULT_TIMEOUT_MS = readPositiveIntEnv("SEC_FETCH_TIMEOUT_MS", 60_000);

interface MaybeHttpError {
  status?: number;
  statusCode?: number;
  httpStatus?: number;
  response?: { status?: number; headers?: Record<string, string> | Headers };
  headers?: Record<string, string> | Headers;
  retryAfter?: number;
  retryable?: boolean;
  retryDate?: Date;
  message?: string;
  name?: string;
  /** workglow's JobTaskFailedError carries the original job error here. */
  jobError?: MaybeHttpError;
}

/** Error code / message heuristics shared with consumers classifying fetch failures. */
export const NETWORK_ERRNO_PATTERN =
  /^E(CONNRESET|TIMEDOUT|PIPE|AI_AGAIN|NOTFOUND|HOSTUNREACH|NETUNREACH)$/;
export const NETWORK_MESSAGE_PATTERN = /network|timeout|timed out|fetch failed|socket hang up/i;

function getStatus(error: MaybeHttpError): number | undefined {
  return error.status ?? error.statusCode ?? error.httpStatus ?? error.response?.status;
}

/** True for any retryable/permanent job-error wrapper, checked by flag and name —
 * `instanceof` can fail across module/realm boundaries. */
export function isRetryableJobErrorShape(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const e = error as MaybeHttpError;
  return (
    e.retryable === true ||
    e.name === "RetryableJobError" ||
    e.jobError?.retryable === true ||
    e.jobError?.name === "RetryableJobError"
  );
}

/**
 * Extracts an HTTP status from an error's structured fields (including a
 * wrapped `jobError`'s `httpStatus`) or, as a last resort, from its message
 * ("...: <status> <reason>" — workglow's HTTP error shape). Returns undefined
 * for network-level or non-HTTP errors.
 */
export function getHttpErrorStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const e = error as MaybeHttpError;
  const status = getStatus(e) ?? (e.jobError ? getStatus(e.jobError) : undefined);
  if (status !== undefined) return status;
  const message = typeof e.message === "string" ? e.message : "";
  const msgStatus = message.match(/:\s*(\d{3})\s/)?.[1];
  if (!msgStatus) return undefined;
  const parsed = Number(msgStatus);
  // A message-derived number is only trusted inside the HTTP status range —
  // ": 999 in" from a parse error is not a status.
  return parsed >= 100 && parsed <= 599 ? parsed : undefined;
}

function isRetriableError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const e = error as MaybeHttpError;

  // Workglow wraps transient HTTP failures (429/5xx, network errors) as
  // RetryableJobError with `retryable: true`. Trust that flag when present.
  // (Don't rely on `instanceof Error` here — RetryableJobError can fail that
  // check across module/realm boundaries even when the prototype chain ends
  // at a real Error.)
  if (e.retryable === true || e.name === "RetryableJobError") return true;
  if (e.name === "PermanentJobError" || e.retryable === false) return false;

  const status = getStatus(e);
  if (status !== undefined) {
    return status === 408 || status === 429 || status >= 500;
  }
  const message = typeof e.message === "string" ? e.message : "";
  // Status pulled out of the message as a last resort — workglow's HTTP error
  // surfaces "...: <status> <reason>" without exposing a numeric field.
  const msgStatus = message.match(/:\s*(\d{3})\s/)?.[1];
  if (msgStatus) {
    const code = Number(msgStatus);
    if (code === 408 || code === 429 || code >= 500) return true;
  }
  // Network-level failures (ECONNRESET, ETIMEDOUT, ENOTFOUND, fetch aborts that
  // weren't user-driven, etc.) all surface as plain Errors with no status.
  const code = (error as NodeJS.ErrnoException).code;
  if (code && NETWORK_ERRNO_PATTERN.test(code)) {
    return true;
  }
  return NETWORK_MESSAGE_PATTERN.test(message);
}

function readHeader(
  headers: Record<string, string> | Headers | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function getRetryAfterMs(error: MaybeHttpError): number | undefined {
  // Workglow's RetryableJobError exposes a parsed `retryDate`; prefer that.
  if (error.retryDate instanceof Date && !Number.isNaN(error.retryDate.getTime())) {
    return Math.max(0, error.retryDate.getTime() - Date.now());
  }
  const fromHeader = readHeader(error.response?.headers ?? error.headers, "Retry-After");
  const raw = error.retryAfter ?? fromHeader;
  if (raw === undefined) return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, raw * 1000);
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return Math.max(0, numeric * 1000);
  const dateMs = Date.parse(String(raw));
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function backoffDelay(attempt: number): number {
  const exponent = Math.min(attempt, 10);
  const base = Math.min(INITIAL_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
  // Jitter to avoid lockstep retries when many jobs fail at once.
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}

/**
 * Combine abort signals into one. Returns the combined signal plus a `cleanup`
 * the caller must invoke (e.g. in `finally`): the fallback path attaches abort
 * listeners to the source signals (including the long-lived `context.signal`),
 * which otherwise accumulate one per attempt for the lifetime of the job/
 * workflow. `cleanup` is a no-op when no listeners were attached.
 */
function combineSignals(signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const noop = () => {};
  const live = signals.filter((s): s is AbortSignal => Boolean(s));
  if (live.length === 0) return { signal: new AbortController().signal, cleanup: noop };
  if (live.length === 1) return { signal: live[0], cleanup: noop };
  if (
    typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any ===
    "function"
  ) {
    return {
      signal: (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any(live),
      cleanup: noop,
    };
  }
  const controller = new AbortController();
  const attached: Array<[AbortSignal, () => void]> = [];
  for (const s of live) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    const onAbort = () => controller.abort(s.reason);
    attached.push([s, onAbort]);
    s.addEventListener("abort", onAbort);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const [s, onAbort] of attached) s.removeEventListener("abort", onAbort);
    },
  };
}

export class SecFetchJob<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output = FetchUrlTaskOutput,
> extends FetchUrlJob<Input, Output> {
  constructor(config: JobConstructorParam<Input, Output>) {
    const input = { ...config.input };
    input.headers = {
      "User-Agent": SecUserAgent,
      ...input.headers,
    };
    super({ ...config, input });
  }

  async execute(input: Input, context: IJobExecuteContext): Promise<Output> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
      // Per-attempt timeout. Use an AbortController + setTimeout so we can
      // clearTimeout() on success: AbortSignal.timeout() leaves an
      // uncancellable timer alive, which accumulates in a high-throughput
      // queue. We still combine with the caller's signal so external aborts
      // win.
      const timeoutController = DEFAULT_TIMEOUT_MS > 0 ? new AbortController() : undefined;
      const timeoutHandle =
        timeoutController && DEFAULT_TIMEOUT_MS > 0
          ? setTimeout(
              () => timeoutController.abort(new Error("SEC fetch timed out")),
              DEFAULT_TIMEOUT_MS
            )
          : undefined;
      const { signal, cleanup } = combineSignals([context.signal, timeoutController?.signal]);

      try {
        return (await super.execute(input, { ...context, signal })) as Output;
      } catch (error) {
        lastError = error;
        if (context.signal.aborted) throw error;
        // A per-attempt timeout is a transient condition the retry loop exists
        // to absorb, but the abort surfaces as a bare Error/AbortError whose
        // shape isRetriableError can't recognise — so key off the timeout
        // controller directly rather than the (lossy) error message.
        const timedOut = timeoutController?.signal.aborted === true;
        if ((!timedOut && !isRetriableError(error)) || attempt === MAX_FETCH_ATTEMPTS - 1) {
          throw error;
        }
        const retryAfter = getRetryAfterMs(error as MaybeHttpError);
        // A 429 means EDGAR is throttling this IP. Pause the WHOLE fetch cluster
        // (every shard process) via the shared limiter's cluster-visible
        // next-available sentinel, so NEW dispatches back off together instead
        // of piling on and keeping the block alive. This job's OWN retry keeps
        // the normal fast backoff (honoring Retry-After when present) so a
        // genuinely transient 429 still recovers quickly; a sustained block just
        // exhausts this job's few attempts and dead-letters (retried next
        // sweep) while the cluster stays paused. Non-429 retryables (5xx,
        // timeouts, network blips) don't pause the cluster.
        if (getHttpErrorStatus(error) === 429) {
          await signalSecFetchThrottle(retryAfter);
        }
        const delay = retryAfter ?? backoffDelay(attempt);
        await sleepWithAbort(delay, context.signal);
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        cleanup();
      }
    }
    throw lastError;
  }
}

/**
 * Sleep for `ms` or reject if `signal` aborts. Always detaches its abort
 * listener on resolve/reject so we don't leak listeners on long-lived signals.
 */
function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
