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
  /** Registrant name, used to skip the SPAC when picking the merger target. */
  readonly issuerName?: string | null;
  /** Primary 8-K body as plain text (Item 1.01 narrative). */
  readonly narrative?: string | null;
}

export interface SpacMilestoneEvent {
  readonly event_type: SpacEventType;
  readonly event_date: string;
  readonly detail: string | null;
}

function compactExhibitToken(value: string): string {
  return value.replace(/[\s._-]/g, "").toLowerCase();
}

/** DESCRIPTION is missing or just restates TYPE (e.g. `<DESCRIPTION>EX-2.1`). */
function isUninformativeDescription(exhibit: SubmissionExhibit): boolean {
  const description = exhibit.description.trim();
  if (description === "") return true;
  return compactExhibitToken(description) === compactExhibitToken(exhibit.type);
}

function isMergerShaped(exhibits: readonly SubmissionExhibit[]): boolean {
  return exhibits.some((e) => {
    if (!/^EX-2(\.|$)/i.test(e.type)) return false;
    return MERGER_EXHIBIT.test(e.description) || isUninformativeDescription(e);
  });
}

const DETAIL_MAX = 1024;

function exhibitDetail(
  eventType: SpacEventType,
  exhibits: readonly SubmissionExhibit[],
  counterparty: string | null
): string | null {
  const showExhibits =
    eventType === "material_agreement" ||
    eventType === "eight_k" ||
    eventType === "definitive_agreement";
  const exhibitLines = showExhibits ? formatExhibitDetail(exhibits) : null;
  const head = eventType === "definitive_agreement" && counterparty ? `# ${counterparty}` : null;
  if (head == null) return exhibitLines;
  if (exhibitLines == null) return head;
  let joined = `${head}\n${exhibitLines}`;
  if (joined.length <= DETAIL_MAX) return joined;
  while (joined.length > DETAIL_MAX) {
    const cut = joined.lastIndexOf("\n");
    if (cut <= 0) return joined.slice(0, DETAIL_MAX);
    joined = joined.slice(0, cut);
  }
  return joined;
}

const MERGER_AGREEMENT =
  /Agreement and Plan of (?:Merger|Reorganization)|Business Combination Agreement/i;

const LEGAL_NAME =
  /[A-Z][A-Za-z0-9.&'’\-]*(?:\s+[A-Z0-9][A-Za-z0-9.&'’\-]*)*,?\s+(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|L\.L\.C\.?|LLC|L\.P\.?|LP|Limited|plc|N\.V\.?)/g;

function foldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tidyName(value: string): string {
  return value.replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
}

function isIssuerName(party: string, issuerName: string | null): boolean {
  if (issuerName == null || issuerName.trim() === "") return false;
  const partyFold = foldName(party);
  const issuerFold = foldName(issuerName);
  return (
    partyFold === issuerFold || issuerFold.startsWith(partyFold) || partyFold.startsWith(issuerFold)
  );
}

function pickFromAmong(blob: string, issuerName: string | null): string | null {
  const names = blob.match(LEGAL_NAME) ?? [];
  for (const raw of names) {
    const name = tidyName(raw);
    const idx = blob.indexOf(raw);
    const after = blob.slice(idx + raw.length, idx + raw.length + 180);
    if (/wholly[-\s]owned subsidiary/i.test(after)) continue;
    if (/merger\s+sub/i.test(name)) continue;
    if (isIssuerName(name, issuerName)) continue;
    return name;
  }
  return null;
}

/** Operating-company counterparty named in a merger 8-K Item 1.01 narrative. */
export function extractMergerCounterparty(
  text: string,
  issuerName: string | null
): string | null {
  const start = text.search(MERGER_AGREEMENT);
  if (start === -1) return null;
  let window = text.slice(start, start + 2500).replace(/\s+/g, " ");
  const solely = window.search(/,\s*and,?\s*solely for the purposes/i);
  if (solely !== -1) window = window.slice(0, solely);

  const amongAt = window.search(/by and (?:among|between)\s+/i);
  if (amongAt !== -1) {
    const blob = window.slice(amongAt).replace(/^by and (?:among|between)\s+/i, "");
    const picked = pickFromAmong(blob, issuerName);
    if (picked) return picked;
  }

  const withNamed = window.match(
    /\bwith\s+([A-Z][A-Za-z0-9.&'’\-]*(?:\s+[A-Z0-9][A-Za-z0-9.&'’\-]*)*,?\s+(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|L\.L\.C\.?|LLC|L\.P\.?|LP))\s*,\s*a\s+/
  );
  if (withNamed) {
    const name = tidyName(withNamed[1]);
    if (!isIssuerName(name, issuerName) && !/merger\s+sub/i.test(name)) return name;
  }
  return null;
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
      const counterparty =
        event_type === "definitive_agreement"
          ? extractMergerCounterparty(ctx.narrative ?? "", ctx.issuerName ?? null)
          : null;
      events.push({
        event_type,
        event_date: eventDate,
        detail: exhibitDetail(event_type, ctx.exhibits, counterparty),
      });
    }
  }
  return events;
}
