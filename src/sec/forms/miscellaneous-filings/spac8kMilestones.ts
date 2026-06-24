/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SpacEventType } from "../../../storage/spac/SpacEventSchema";

/** 8-K item code -> SPAC lifecycle event. Only these four items participate. */
const ITEM_TO_SPAC_EVENT: Record<string, SpacEventType> = {
  "1.01": "definitive_agreement",
  "1.02": "terminated",
  "2.01": "completed",
  "5.07": "vote",
};

export interface SpacMilestoneEvent {
  readonly event_type: SpacEventType;
  readonly event_date: string;
}

/**
 * Map a filing's 8-K item codes to SPAC lifecycle events. `eventDate` is the
 * caller's resolved triggering-event date (the 8-K period-of-report, falling
 * back to the filing date). Non-milestone items are dropped.
 */
export function mapItemCodesToSpacEvents(
  itemCodes: readonly string[],
  eventDate: string
): SpacMilestoneEvent[] {
  const events: SpacMilestoneEvent[] = [];
  for (const code of itemCodes) {
    const event_type = ITEM_TO_SPAC_EVENT[code];
    if (event_type) events.push({ event_type, event_date: eventDate });
  }
  return events;
}
