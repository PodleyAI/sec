/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SpacEventType } from "../../../storage/spac/SpacEventSchema";
import { legalFormProseSuffixAlternation } from "../../../util/legalForms";
import type { SubmissionExhibit } from "../registration-statements/s1/parseSubmission";
import { formatExhibitDetail } from "../registration-statements/s1/parseSubmission";

const MERGER_EXHIBIT = /merger|business combination|agreement and plan/i;

export interface PendingDealHint {
  readonly definitive_agreement_date: string | null;
  readonly proxy_date: string | null;
}

export interface MilestoneMapContext {
  readonly ipoDate: string | null;
  /**
   * S-1/DRS registration date, the fallback floor when `ipoDate` is unknown.
   * `ipo_date` is written from a priced prospectus (424B1/B4, or a 424B3 for a
   * known SPAC that has not already IPOed). A SPAC row minted by the S-1 AI
   * content classifier (a SIC-miscoded filer) legitimately has none until that
   * prospectus is processed.
   */
  readonly registrationDate: string | null;
  readonly exhibits: readonly SubmissionExhibit[];
  /**
   * The attempt pending as of THIS filing, derived from the events dated
   * strictly before it — never from the current derived deal set, which later
   * filings have already moved (see `pendingDealBefore`).
   */
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

function exhibitLabelBody(value: string): string {
  return compactExhibitToken(value).replace(/^(exhibit|ex)/, "");
}

/**
 * DESCRIPTION is missing or just restates TYPE (`EX-2.1`, `EXHIBIT 2.1`).
 * Filers write either spelling; compacting punctuation alone leaves
 * `exhibit21` ≠ `ex21`, which treated SuperBac's BCA as a non-merger EX-2.
 * Strip a leading `exhibit` (longer token first) or `ex` from both sides so
 * `EX-2.1` and `EXHIBIT 2.1` both reduce to `21`.
 */
function isUninformativeDescription(exhibit: SubmissionExhibit): boolean {
  const description = exhibit.description.trim();
  if (description === "") return true;
  return exhibitLabelBody(description) === exhibitLabelBody(exhibit.type);
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
  const named =
    eventType === "definitive_agreement" || eventType === "name_change" ? counterparty : null;
  const head = named ? `# ${named}` : null;
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

const LEGAL_NAME = new RegExp(
  `[A-Z][A-Za-z0-9.&'’\\-]*(?:\\s+[A-Z0-9][A-Za-z0-9.&'’\\-]*)*,?\\s+(?:${legalFormProseSuffixAlternation})`,
  "g"
);

const WITH_NAMED = new RegExp(
  `\\bwith\\s+([A-Z][A-Za-z0-9.&'’\\-]*(?:\\s+[A-Z0-9][A-Za-z0-9.&'’\\-]*)*,?\\s+(?:${legalFormProseSuffixAlternation}))\\s*,\\s*a\\s+`
);

function foldName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

/** Cayman PubCo / Newco / Holdco listing vehicle, not the operating company. */
function isListingVehicle(name: string, after: string): boolean {
  if (/\b(?:pubco|newco|holdco)\b/i.test(name)) return true;
  return /\(\s*["“']?\s*(?:PubCo|Holdco|HoldCo|Newco|NewCo)\s*["”']?\s*\)/i.test(after);
}

function pickFromAmong(blob: string, issuerName: string | null): string | null {
  const names = blob.match(LEGAL_NAME) ?? [];
  for (const raw of names) {
    const name = tidyName(raw);
    const idx = blob.indexOf(raw);
    const after = blob.slice(idx + raw.length, idx + raw.length + 180);
    if (/wholly[-\s]owned subsidiary/i.test(after)) continue;
    if (/merger\s+sub/i.test(name) || /merger\s+sub/i.test(after)) continue;
    if (isListingVehicle(name, after)) continue;
    if (isIssuerName(name, issuerName)) continue;
    return name;
  }
  return null;
}

function partyListBlob(window: string): string | null {
  const amongAt = window.search(/by and (?:among|between)\s+/i);
  if (amongAt !== -1) {
    return window.slice(amongAt).replace(/^by and (?:among|between)\s+/i, "");
  }
  // SuperBac-shaped: "with (i) PubCo … (iv) SuperBac Biotechnology Solutions S.A."
  const withListAt = window.search(/\bwith\s+\(/i);
  if (withListAt === -1) return null;
  return window.slice(withListAt).replace(/^\s*with\s+/i, "");
}

function tidyChangedName(value: string): string {
  const name = tidyName(value);
  // "changed to Foo Corp." — the last period is sentence punctuation, not
  // "Foo L.P." / "Bar S.A." where the dots are the legal form.
  if (/\.[A-Za-z]\.$/.test(name)) return name;
  return name.replace(/\.$/, "");
}

const FROM_TO_NAME = new RegExp(
  `(?:change(?:d)?(?:\\s+the)?\\s+name(?:\\s+of\\s+the\\s+(?:Company|Registrant|Issuer))?|changed\\s+its\\s+name)\\s+from\\s+["“']([^"”']+)["”']\\s+to\\s+["“']([^"”']+)["”']`,
  "i"
);

/**
 * `spac.current_name`'s own `maxLength`. A clause longer than this is prose,
 * not a registrant name, and is dropped rather than cut down: a truncated name
 * is a wrong fact, a dropped one only costs a `name_change` event.
 */
const CHANGED_NAME_MAX = 200;

/**
 * The lead-in carries the `i` flag; the name itself must not. Under `/i` the
 * capitalized-token run matches lowercase words too, so it never terminates —
 * it ran through the rest of the sentence and into the next one (`.` is inside
 * the token class, so the sentence period is consumed as well).
 */
const CHANGED_TO_LEAD_IN =
  /(?:name of the (?:Company|Registrant|Issuer)|its name)\s+has been changed to\s+/i;

const CHANGED_NAME_TOKEN = `[A-Za-z0-9.&'’\\-]*`;

/**
 * A name that ends in a legal form terminates there. The middle is LAZY so it
 * stops at the FIRST legal form rather than one further down the paragraph,
 * which is also what stops a capitalized continuation ("… Corp. The Board …").
 */
const CHANGED_TO_WITH_LEGAL_FORM = new RegExp(
  `^["“']?([A-Z]${CHANGED_NAME_TOKEN}(?:\\s+[A-Z0-9]${CHANGED_NAME_TOKEN})*?,?\\s+(?:${legalFormProseSuffixAlternation}))`
);

/** Fallback for a name carrying no recognized legal form ("Rumble"). */
const CHANGED_TO_BARE = new RegExp(
  `^["“']?([A-Z]${CHANGED_NAME_TOKEN}(?:\\s+[A-Z0-9]${CHANGED_NAME_TOKEN})*)`
);

/** New registrant name from an Item 5.03 name-change 8-K. */
export function extractNameChange(text: string): string | null {
  const collapsed = text.replace(/\s+/g, " ");
  const fromTo = collapsed.match(FROM_TO_NAME);
  if (fromTo) return tidyChangedName(fromTo[2]);
  const leadIn = collapsed.match(CHANGED_TO_LEAD_IN);
  if (leadIn?.index == null) return null;
  const rest = collapsed.slice(leadIn.index + leadIn[0].length);
  const named = rest.match(CHANGED_TO_WITH_LEGAL_FORM) ?? rest.match(CHANGED_TO_BARE);
  if (!named) return null;
  const name = tidyChangedName(named[1]);
  if (name === "" || name.length > CHANGED_NAME_MAX) return null;
  return name;
}

/** Operating-company counterparty named in a merger 8-K Item 1.01 narrative. */
export function extractMergerCounterparty(text: string, issuerName: string | null): string | null {
  const start = text.search(MERGER_AGREEMENT);
  if (start === -1) return null;
  let window = text.slice(start, start + 2500).replace(/\s+/g, " ");
  const solely = window.search(/,\s*and,?\s*solely for the purposes/i);
  if (solely !== -1) window = window.slice(0, solely);

  const blob = partyListBlob(window);
  if (blob != null) {
    const picked = pickFromAmong(blob, issuerName);
    if (picked) return picked;
  }

  const withNamed = window.match(WITH_NAMED);
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
  // The date gate exists to reject the SPAC's own pre-IPO underwriting and
  // formation agreements, so only a KNOWN earlier anchor demotes a
  // merger-shaped 1.01. An unknown floor is not evidence of a pre-IPO filing:
  // treating it as one demoted every de-SPAC milestone of a SIC-miscoded SPAC
  // to `material_agreement`, which opens no deal at all. The real
  // discriminator is the merger-shaped EX-2 exhibit.
  const floor = ctx.ipoDate ?? ctx.registrationDate;
  const preIpo = floor != null && eventDate < floor;
  const pending = ctx.pendingDeal;
  const pendingMerger = pending != null && pending.proxy_date != null;

  for (const code of itemCodes) {
    let event_type: SpacEventType | null = null;
    switch (code) {
      case "1.01":
        event_type = !preIpo && mergerExhibits ? "definitive_agreement" : "material_agreement";
        break;
      case "1.02":
        event_type = pending != null || mergerExhibits ? "terminated" : "material_agreement";
        break;
      case "2.01":
        event_type = "completed";
        break;
      case "5.03":
        // Bylaw / fiscal-year 5.03s are silent. Only a narrative that names the
        // new registrant is a name_change — otherwise this item is ignored.
        event_type = extractNameChange(ctx.narrative ?? "") != null ? "name_change" : null;
        break;
      case "5.07":
        // A pending DA is not enough: annual meetings and charter-extension
        // votes fire 5.07 while a deal is open. Only a definitive merger /
        // consent proxy means this meeting is about the combination.
        event_type = pendingMerger ? "vote" : "eight_k";
        break;
      default:
        break;
    }
    if (event_type) {
      const counterparty =
        event_type === "definitive_agreement"
          ? extractMergerCounterparty(ctx.narrative ?? "", ctx.issuerName ?? null)
          : event_type === "name_change"
            ? extractNameChange(ctx.narrative ?? "")
            : null;
      events.push({
        event_type,
        event_date: eventDate,
        detail: exhibitDetail(event_type, ctx.exhibits, counterparty),
      });
    }
  }
  // A name-change 8-K also files Item 1.01 for the charter amendment. That is
  // the same fact as 5.03, not a separate misc agreement.
  if (events.some((e) => e.event_type === "name_change")) {
    return events.filter((e) => e.event_type !== "material_agreement");
  }
  return events;
}
