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
import { SecUserAgent } from "../config/Constants";

const MAX_FETCH_ATTEMPTS = 4;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const DEFAULT_TIMEOUT_MS = Number(process.env.SEC_FETCH_TIMEOUT_MS ?? 60_000);

interface MaybeHttpError {
  status?: number;
  statusCode?: number;
  response?: { status?: number; headers?: Record<string, string> | Headers };
  headers?: Record<string, string> | Headers;
  retryAfter?: number;
  message?: string;
}

function getStatus(error: MaybeHttpError): number | undefined {
  return error.status ?? error.statusCode ?? error.response?.status;
}

function isRetriableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = getStatus(error as MaybeHttpError);
  if (status !== undefined) {
    return status === 408 || status === 429 || status >= 500;
  }
  // Network-level failures (ECONNRESET, ETIMEDOUT, ENOTFOUND, fetch aborts that
  // weren't user-driven, etc.) all surface as plain Errors with no status.
  const code = (error as NodeJS.ErrnoException).code;
  if (code && /^E(CONNRESET|TIMEDOUT|PIPE|AI_AGAIN|NOTFOUND|HOSTUNREACH|NETUNREACH)$/.test(code)) {
    return true;
  }
  return /network|timeout|fetch failed|socket hang up/i.test(error.message);
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

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const live = signals.filter((s): s is AbortSignal => Boolean(s));
  if (live.length === 0) return new AbortController().signal;
  if (live.length === 1) return live[0];
  if (typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any === "function") {
    return (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any(live);
  }
  const controller = new AbortController();
  for (const s of live) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
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
      // Per-attempt timeout so a hung TCP connection cannot pin a queue slot
      // forever; respects the caller's abort signal as well.
      const timeoutSignal =
        DEFAULT_TIMEOUT_MS > 0 ? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) : undefined;
      const signal = combineSignals([context.signal, timeoutSignal]);

      try {
        return (await super.execute(input, { ...context, signal })) as Output;
      } catch (error) {
        lastError = error;
        if (context.signal.aborted) throw error;
        if (!isRetriableError(error) || attempt === MAX_FETCH_ATTEMPTS - 1) throw error;
        const retryAfter = getRetryAfterMs(error as MaybeHttpError);
        const delay = retryAfter ?? backoffDelay(attempt);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          const onAbort = () => {
            clearTimeout(timer);
            reject(context.signal.reason ?? new Error("aborted"));
          };
          context.signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    }
    throw lastError;
  }
}
