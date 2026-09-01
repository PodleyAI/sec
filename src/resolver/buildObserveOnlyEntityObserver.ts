/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { PersonObservationTitleRepo } from "../storage/observation/PersonObservationTitleRepo";
import type { ObserveOnlyEntityObserver } from "./EntityObserver";
import { EntityObserver } from "./EntityObserver";

/**
 * Constructs an {@link EntityObserver} that records observations and their
 * titles and nothing else, so a form storage module does not repeat the
 * ceremony.
 *
 * It lives apart from `buildEntityObserver` rather than beside it because
 * sharing a module would pull that function's dozen canonical repos and both
 * resolvers into the graph of every caller that wants none of them.
 */
export function buildObserveOnlyEntityObserver(): ObserveOnlyEntityObserver {
  return new EntityObserver({
    personObservationRepo: new PersonObservationRepo(),
    personObservationTitleRepo: new PersonObservationTitleRepo(),
    companyObservationRepo: new CompanyObservationRepo(),
  });
}
