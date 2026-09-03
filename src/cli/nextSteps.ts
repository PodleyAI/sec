/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isJsonOutput } from "./isJsonOutput";

export interface NextStep {
  /** The exact command to run, copy-pasteable. */
  readonly command: string;
  /** Why it is the next thing — one clause, lowercase, no trailing period. */
  readonly why: string;
}

/**
 * Suggestions collected by the command currently running.
 *
 * Process-global rather than threaded through every action: a command's own
 * body is where it knows what it just did, and passing a collector down through
 * `runWorkflowCli` into a task and back would put the mechanism in the way of
 * the thing it exists to make easy.
 */
let pending: NextStep[] = [];
let quiet = false;

/**
 * Records what to run next.
 *
 * Every command's last act, when there is an obvious next move. A command with
 * nothing to suggest calls nothing — an empty "Next:" heading is worse than no
 * heading at all.
 */
export function suggest(...steps: readonly NextStep[]): void {
  pending.push(...steps);
}

/** Whether `--quiet` was passed. Set once per process by the global options. */
export function setNextStepsQuiet(value: boolean): void {
  quiet = value;
}

/** The collected steps, clearing them. Called by `runCommand`. */
export function drainNextSteps(): readonly NextStep[] {
  const steps = pending;
  pending = [];
  return steps;
}

/** Test-only: registration is process-global. */
export function resetNextStepsForTesting(): void {
  pending = [];
  quiet = false;
}

/**
 * Renders the collected steps, or nothing.
 *
 * Under `--json` the steps are the caller's to emit as data — printing them
 * would corrupt a stream something is parsing — so this prints nothing and
 * leaves them to {@link drainNextSteps}.
 */
export function renderNextSteps(steps: readonly NextStep[]): void {
  if (steps.length === 0 || quiet || isJsonOutput()) return;
  const width = Math.max(...steps.map((step) => step.command.length));
  console.log("\n  Next:");
  for (const step of steps) {
    console.log(`    ${step.command.padEnd(width)}   ${step.why}`);
  }
}
