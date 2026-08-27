/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What each extraction model call sent and what came back.
 *
 * Off unless `SEC_TRACE_DIR` names a directory, and cheap when off: one
 * memoized environment read per call. Extraction is the expensive path in this
 * codebase and a tracing facility that costs anything when disabled would be
 * turned off and left off.
 *
 * **Section text is stored once and referenced by hash.** A filing's
 * beneficial-ownership section runs to ~57k characters and risk factors to
 * 246k; a record per attempt that inlined it would write the same megabytes
 * repeatedly and make the trace unreadable. `sections/<sha256>.txt` holds one
 * copy, and every record naming that hash refers to it.
 *
 * **There is no raw response text here, and that is a limit of the seam, not an
 * omission.** `StructuredGenerationTask` declares one output port, `object` —
 * the parsed and validated result. The unparsed stream is not exposed, so what
 * a trace can honestly record is the parsed object on success and, on a schema
 * failure, each attempt's rejected object with its validation errors (which
 * `StructuredOutputValidationError` does carry). Capturing the raw stream would
 * need a new port in `@workglow/ai`.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** How a call ended, in the vocabulary the section runner already dead-letters by. */
export const CALL_OUTCOMES = [
  "ok",
  "invalid-output",
  "rate-limited",
  "nonce-mismatch",
  "error",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** One validation round, mirroring `StructuredOutputValidationAttempt`. */
export interface CallValidationAttempt {
  readonly attempt: number;
  readonly errors: ReadonlyArray<{ readonly path: string; readonly message: string }>;
  readonly object: Record<string, unknown> | undefined;
}

export interface CallRecord {
  readonly seq: number;
  readonly at: string;
  /** Extractor/section label, as the section runner names it. */
  readonly label: string;
  readonly modelId: string | null;
  /** 1-based attempt within {@link runGuardedExtraction}'s retry loop. */
  readonly attempt: number;
  readonly nonce: boolean;
  readonly durationMs: number;
  readonly outcome: CallOutcome;
  /**
   * True when the result came from the extraction cache instead of the model.
   *
   * A flag rather than a new {@link CallOutcome}, because a cache hit IS an
   * `ok` — a validated object was produced — and consumers that count `ok` as
   * "this section succeeded" are right to keep counting it. What changes is the
   * COST: a hit carries no `usage`, so anything doing cost arithmetic has to be
   * able to tell the two apart, and an outcome bucket nobody knew to look in
   * would have silently zeroed a fifth of a sweep's calls instead.
   */
  readonly cached: boolean;
  readonly promptChars: number;
  readonly instructions: string;
  /** Reference into `sections/`, so the prose is stored once per distinct text. */
  readonly sectionSha256: string;
  readonly sectionChars: number;
  /** The parsed object, on success. */
  readonly object: Record<string, unknown> | undefined;
  /** Rejected objects and their errors, when every attempt failed validation. */
  readonly validationAttempts: readonly CallValidationAttempt[] | undefined;
  readonly errorName: string | undefined;
  readonly errorMessage: string | undefined;
  readonly usage: Record<string, unknown> | undefined;
}

const CALLS_FILE = "calls.ndjson";
const SECTIONS_DIR = "sections";

let resolved = false;
let traceDir: string | undefined;
let seq = 0;
const writtenSections = new Set<string>();

/**
 * The configured trace directory, created on first use, or undefined when off.
 *
 * An unusable directory turns tracing OFF rather than throwing: this runs on
 * the extraction path (`isCallTracing()` is the first thing every guarded call
 * asks), and an unwritable `SEC_TRACE_DIR` must not take down the run it was
 * meant to observe — the same contract {@link recordCall} keeps.
 */
function dir(): string | undefined {
  if (!resolved) {
    resolved = true;
    const configured = (process.env.SEC_TRACE_DIR ?? "").trim();
    if (configured.length > 0) {
      try {
        mkdirSync(join(configured, SECTIONS_DIR), { recursive: true });
        traceDir = configured;
      } catch (err) {
        console.warn(
          `SEC_TRACE_DIR '${configured}' is not usable, so call tracing is off: ` +
            `${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
  return traceDir;
}

/** True when calls are being recorded. Callers use it to skip building a record. */
export function isCallTracing(): boolean {
  return dir() !== undefined;
}

/** Re-read the environment. For tests, which set the variable per case. */
export function resetCallTracingForTesting(): void {
  resolved = false;
  traceDir = undefined;
  seq = 0;
  writtenSections.clear();
}

export function sectionHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Store the section prose once, returning its hash.
 *
 * De-duplicated in memory AND against the filesystem: a sweep re-running one
 * filing appends to the same directory, and rewriting an identical section is
 * pure I/O for no new information.
 */
function storeSection(text: string, root: string): string {
  const hash = sectionHash(text);
  if (writtenSections.has(hash)) return hash;
  const path = join(root, SECTIONS_DIR, `${hash}.txt`);
  if (!existsSync(path)) writeFileSync(path, text, "utf-8");
  writtenSections.add(hash);
  return hash;
}

export interface CallTraceInput {
  readonly label: string;
  readonly modelId: string | null;
  readonly attempt: number;
  readonly nonce: boolean;
  readonly durationMs: number;
  readonly outcome: CallOutcome;
  readonly cached?: boolean | undefined;
  readonly prompt: string;
  readonly instructions: string;
  readonly sectionText: string;
  readonly object?: Record<string, unknown> | undefined;
  readonly validationAttempts?: readonly CallValidationAttempt[] | undefined;
  readonly errorName?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly usage?: Record<string, unknown> | undefined;
}

/**
 * Append one call to the trace. A no-op when tracing is off.
 *
 * Never throws: a full disk or an unwritable directory must not fail an
 * extraction that would otherwise have succeeded. A tracing facility that can
 * take down the run it is observing is worse than no tracing.
 */
export function recordCall(input: CallTraceInput): void {
  const root = dir();
  if (root === undefined) return;
  try {
    const record: CallRecord = {
      seq: seq++,
      at: new Date().toISOString(),
      label: input.label,
      modelId: input.modelId,
      attempt: input.attempt,
      nonce: input.nonce,
      durationMs: input.durationMs,
      outcome: input.outcome,
      cached: input.cached === true,
      promptChars: input.prompt.length,
      instructions: input.instructions,
      sectionSha256: storeSection(input.sectionText, root),
      sectionChars: input.sectionText.length,
      object: input.object,
      validationAttempts: input.validationAttempts,
      errorName: input.errorName,
      errorMessage: input.errorMessage,
      usage: input.usage,
    };
    appendFileSync(join(root, CALLS_FILE), `${JSON.stringify(record)}\n`, "utf-8");
  } catch {
    // Deliberately silent, and deliberately not disabling tracing: a transient
    // write failure should cost one record, not the rest of the sweep's.
  }
}

/** Path of the NDJSON file a trace directory writes to. */
export function callsFilePath(root: string): string {
  return join(root, CALLS_FILE);
}

/** Path of a section's stored prose. */
export function sectionFilePath(root: string, hash: string): string {
  return join(root, SECTIONS_DIR, `${hash}.txt`);
}
