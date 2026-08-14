/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SpacEventType } from "../../../storage/spac/SpacEventSchema";
import type { SubmissionExhibit } from "../registration-statements/s1/parseSubmission";
import { formatExhibitDetail } from "../registration-statements/s1/parseSubmission";

const MERGER_EXHIBIT = /merger|business combination|agreement and plan/i;

export interface PendingDealHint {
  readonly definitive_agreement_date: string | null;
  readonly proxy_date: string | null;
}

export interface MilestoneMapContext {
  readonly ipoDate: string | null;
  readonly exhibits: readonly SubmissionExhibit[];
  readonly pendingDeal: PendingDealHint | null;
}

export interface SpacMilestoneEvent {
  readonly event_type: SpacEventType;
  readonly event_date: string;
  readonly detail: string | null;
}

function isMergerShaped(exhibits: readonly SubmissionExhibit[]): boolean {
  return exhibits.some((e) => /^EX-2(\.|$)/i.test(e.type) && MERGER_EXHIBIT.test(e.description));
}

function exhibitDetail(
  eventType: SpacEventType,
  exhibits: readonly SubmissionExhibit[]
): string | null {
  if (eventType !== "material_agreement" && eventType !== "eight_k") return null;
  return formatExhibitDetail(exhibits);
}

export function mapItemCodesToSpacEvents(
  itemCodes: readonly string[],
  eventDate: string,
  ctx: MilestoneMapContext
): SpacMilestoneEvent[] {
  const events: SpacMilestoneEvent[] = [];
  const mergerExhibits = isMergerShaped(ctx.exhibits);
  const postIpo = ctx.ipoDate != null && eventDate >= ctx.ipoDate;
  const pending = ctx.pendingDeal;
  const pendingMerger =
    pending != null &&
    (pending.definitive_agreement_date != null || pending.proxy_date != null);

  for (const code of itemCodes) {
    let event_type: SpacEventType | null = null;
    switch (code) {
      case "1.01":
        event_type = postIpo && mergerExhibits ? "definitive_agreement" : "material_agreement";
        break;
      case "1.02":
        event_type = pending != null || mergerExhibits ? "terminated" : "material_agreement";
        break;
      case "2.01":
        event_type = "completed";
        break;
      case "5.07":
        event_type = pendingMerger ? "vote" : "eight_k";
        break;
      default:
        break;
    }
    if (event_type) {
      events.push({
        event_type,
        event_date: eventDate,
        detail: exhibitDetail(event_type, ctx.exhibits),
      });
    }
  }
  return events;
}

export const LIFECYCLE_ITEM_EVENT_TYPES: readonly SpacEventType[] = [
  "definitive_agreement",
  "terminated",
  "completed",
  "vote",
];
