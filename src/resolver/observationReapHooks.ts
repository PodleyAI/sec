/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** One reaped observation, named by the tier it belonged to and its id. */
export interface ReapedObservation {
  readonly kind: "person" | "company";
  readonly observation_id: number;
}

/**
 * Something keyed to an observation that this package does not own.
 *
 * `reapStaleObservations` deletes the rows a smaller re-extraction orphaned, and
 * everything keyed to an observation has to go with it. What that includes is not
 * fixed here: a downstream package holding the identity tier keys its links to
 * these same observations, and a link left pointing at a reaped one makes a
 * rebuild RAISE rather than write around it — which is deliberate, and is why a
 * missed deletion is not a small problem. It stops every later rebuild of that
 * tier, at a point far from the reap that caused it.
 *
 * So a hook is expected to throw on failure rather than log and continue: the
 * reap that could not finish is the last moment anything can name the
 * observation, and its caller already turns a throw into a filing-level dead
 * letter that a re-run retries.
 */
export type ObservationReapHook = (observation: ReapedObservation) => Promise<void>;

const HOOKS: ObservationReapHook[] = [];

/**
 * Register cleanup for rows keyed to an observation this package does not own.
 * Every registered hook runs for every reaped observation, in registration order.
 */
export function registerObservationReapHook(hook: ObservationReapHook): void {
  HOOKS.push(hook);
}

export function getObservationReapHooks(): readonly ObservationReapHook[] {
  return HOOKS;
}

/** Test hook: drop all registrations so a test starts from an empty registry. */
export function clearObservationReapHooksForTesting(): void {
  HOOKS.length = 0;
}
