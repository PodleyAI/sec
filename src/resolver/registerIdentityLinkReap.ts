/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import { registerObservationReapHook } from "./observationReapHooks";

/**
 * Delete a reaped observation's identity links.
 *
 * Registered rather than called inline because the links belong to the identity
 * tier, and the reaper belongs to the extraction path that owns the
 * observations. While both ship here the difference is invisible; the moment
 * the tier ships elsewhere it is the whole of the seam, and a reaper still
 * naming the tables would be a dependency running the wrong way.
 *
 * Idempotent: registering twice would delete twice, and deleting a link that is
 * already gone is a no-op, but the guard keeps the hook list from growing on a
 * repeated bootstrap.
 */
let registered = false;

export function registerIdentityLinkReap(): void {
  if (registered) return;
  registered = true;
  registerObservationReapHook(async ({ kind, observation_id }) => {
    if (kind === "person") {
      await new PersonIdentityLinkRepo().deleteForObservation(observation_id);
      return;
    }
    await new CompanyIdentityLinkRepo().deleteForObservation(observation_id);
  });
}

/** Test hook: allow a later `registerIdentityLinkReap()` to register again. */
export function resetIdentityLinkReapForTesting(): void {
  registered = false;
}
