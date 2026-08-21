/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FOCUS_VOCABULARY, type SpacProfileRow } from "./spacProfileSchema";

const WINDOW_AFTER = 500;

const ON_FRAME =
  "(?:identifying|industries|sectors|a\\s+(?:company|business)|target|companies\\s+(?:in|within|focused|operating)|businesses\\s+(?:in|within|throughout|focused|operating))";
const INTENT = new RegExp(
  String.raw`\bwe\s+(?:intend to|will|expect to|currently expect to)(?:\s+\S+){0,8}\s+focus(?:ed)?(?:\s+our\s+(?:search|efforts))?\s+on\s+${ON_FRAME}\b`,
  "gi"
);
const INTENT_OUR = new RegExp(
  String.raw`\bour\s+(?:efforts|search|business strategy)\b[\s\S]{0,80}?\bfocus(?:ed)?(?:\s+our\s+(?:search|efforts))?\s+on\s+${ON_FRAME}\b`,
  "gi"
);

const GEO_PREFERENCE =
  /\b(?:give preference|consideration to assets)\b[\s\S]{0,160}?\blocated in\b/gi;

const REJECT_FRAME =
  /\bfocus(?:ed)?\s+on\s+(?:situations|improving|achieving|potential acquisition targets that exhibit)\b/i;

const FOCUS_ALIASES: ReadonlyArray<{
  readonly re: RegExp;
  readonly tag: (typeof FOCUS_VOCABULARY)[number];
}> = [
  { re: /\bfinancial services\b/gi, tag: "Financial Services" },
  { re: /\basset management\b/gi, tag: "Asset Management" },
  { re: /\b(?:data\s*(?:&|and|,)\s*analytics|big data analytics)\b/gi, tag: "Data & Analytics" },
  { re: /\b(?:internet commerce|e-?commerce)\b/gi, tag: "E-commerce" },
  { re: /\blodging\b/gi, tag: "Hospitality" },
  { re: /\bfin\s*tech\b/gi, tag: "FinTech" },
  { re: /\bprop\s*tech\b/gi, tag: "PropTech" },
  { re: /\bbiopharmaceuticals?\b/gi, tag: "Biopharmaceuticals" },
  { re: /\bhealth[\s-]?care\b/gi, tag: "Healthcare" },
  { re: /\bartificial intelligence\b/gi, tag: "Artificial Intelligence" },
  { re: /\binternet of things\b/gi, tag: "Internet of Things" },
  { re: /\boil(?:\s+|&| and )\s*gas\b/gi, tag: "Oil & Gas" },
  { re: /\bfood(?:\s+|&| and )\s*beverage\b/gi, tag: "Food & Beverage" },
  { re: /\breal estate\b/gi, tag: "Real Estate" },
  { re: /\brenewable energy\b/gi, tag: "Renewable Energy" },
  { re: /\belectric vehicles?\b/gi, tag: "Electric Vehicles" },
  { re: /\bautonomous vehicles?\b/gi, tag: "Autonomous Vehicles" },
  { re: /\bnatural resources\b/gi, tag: "Natural Resources" },
  { re: /\bmaterials?(?:\s+supply chain)?\b/gi, tag: "Materials" },
  { re: /\bdefense(?:\s+technology)?\b/gi, tag: "Defense" },
  { re: /\b(?:mobile communications|telecommunications)\b/gi, tag: "Telecommunications" },
];

const LOCATION_ALIASES: ReadonlyArray<{ readonly re: RegExp; readonly tag: string }> = [
  { re: /\bsoutheast asia\b/gi, tag: "Southeast Asia" },
  { re: /\bnorth america\b/gi, tag: "North America" },
  { re: /\blatin america\b/gi, tag: "Latin America" },
  { re: /\bunited states\b/gi, tag: "United States" },
  { re: /\bunited kingdom\b/gi, tag: "United Kingdom" },
  { re: /\bhong kong\b/gi, tag: "Hong Kong" },
  { re: /\bmiddle east\b/gi, tag: "Middle East" },
  { re: /\bgreater china\b/gi, tag: "China" },
  { re: /\bpeople'?s republic of china\b/gi, tag: "China" },
  { re: /\bmacau\b/gi, tag: "Macau" },
  { re: /\basia\b/gi, tag: "Asia" },
  { re: /\beurope\b/gi, tag: "Europe" },
  { re: /\bchina\b/gi, tag: "China" },
  { re: /\bcanada\b/gi, tag: "Canada" },
  { re: /\baustralia\b/gi, tag: "Australia" },
  { re: /\bjapan\b/gi, tag: "Japan" },
  { re: /\bindia\b/gi, tag: "India" },
  { re: /\bafrica\b/gi, tag: "Africa" },
];

/** IoT is its own vocab tag; the AI alias above would steal it. Split after. */
const IOT_RE = /\b(?:iot|internet of things)\b/gi;

export function parseSpacProfile(text: string): SpacProfileRow | null {
  try {
    return findProfile(text);
  } catch {
    return null;
  }
}

/** Asks the parser, so a throw is a "no" here exactly as it is there. */
export function hasProfileIdentification(text: string | undefined): boolean {
  if (text === undefined || text.trim() === "") return false;
  return parseSpacProfile(text) !== null;
}

function findProfile(text: string): SpacProfileRow | null {
  const windows = collectWindows(text);
  const focus: string[] = [];
  const focus_location: string[] = [];
  const seenFocus = new Set<string>();
  const seenLoc = new Set<string>();
  let source_span = "";
  for (const window of windows) {
    const f = extractFocus(window);
    const loc = extractLocations(window);
    if (f.length === 0 && loc.length === 0) continue;
    if (source_span === "") source_span = locatableSpan(text, window);
    for (const tag of f) {
      if (seenFocus.has(tag)) continue;
      seenFocus.add(tag);
      focus.push(tag);
    }
    for (const tag of loc) {
      if (seenLoc.has(tag)) continue;
      seenLoc.add(tag);
      focus_location.push(tag);
    }
  }
  if (focus.length === 0 && focus_location.length === 0) return null;
  if (source_span === "" || !text.includes(source_span)) return null;
  return {
    focus,
    focus_location,
    description: null,
    team: null,
    url_spac: null,
    confidence: 1,
    source_span,
    source: "deterministic",
  };
}

function collectWindows(text: string): string[] {
  const out: string[] = [];
  for (const re of [INTENT, INTENT_OUR, GEO_PREFERENCE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const raw = text.slice(start, start + m[0].length + WINDOW_AFTER);
      let window = clipSentence(raw);
      if (
        extractFocus(window).length === 0 &&
        extractLocations(window).length === 0 &&
        /industries that (?:align with|complement)/i.test(window)
      ) {
        const rest = text.slice(start + window.length);
        window = `${window}${clipSentence(rest.slice(0, WINDOW_AFTER))}`;
      }
      if (REJECT_FRAME.test(window)) continue;
      out.push(window);
    }
  }
  return out;
}

function extractFocus(window: string): string[] {
  const occupied: Array<{ start: number; end: number }> = [];
  const found: Array<{ tag: string; start: number }> = [];
  const seen = new Set<string>();
  const add = (tag: string, start: number, end: number): void => {
    if (seen.has(tag)) return;
    if (overlaps(occupied, start, end)) return;
    seen.add(tag);
    occupied.push({ start, end });
    found.push({ tag, start });
  };
  for (const { re, tag } of FOCUS_ALIASES) {
    if (tag === "Financial Services" && /\(\s*["“']?FinTech/i.test(window)) continue;
    if (tag === "Real Estate" && /\(\s*["“']?PropTech/i.test(window)) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(window)) !== null) {
      add(tag, m.index, m.index + m[0].length);
    }
  }
  IOT_RE.lastIndex = 0;
  let iot: RegExpExecArray | null;
  while ((iot = IOT_RE.exec(window)) !== null) {
    add("Internet of Things", iot.index, iot.index + iot[0].length);
  }
  const vocab = [...FOCUS_VOCABULARY].toSorted((a, b) => b.length - a.length);
  for (const tag of vocab) {
    const re = new RegExp(`\\b${escapeRe(tag)}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(window)) !== null) {
      if (
        tag === "Technology" &&
        /(?:gaming|defense|space|information)\s+$/i.test(
          window.slice(Math.max(0, m.index - 20), m.index)
        )
      ) {
        continue;
      }
      if (
        tag === "Infrastructure" &&
        /(?:blockchain|crypto|digital|data(?:-intensive)?|cloud|fintech)\s+$/i.test(
          window.slice(Math.max(0, m.index - 20), m.index)
        )
      ) {
        continue;
      }
      if (tag === "Real Estate" && /\(\s*["“']?PropTech/i.test(window)) continue;
      if (tag === "Financial Services" && /\(\s*["“']?FinTech/i.test(window)) continue;
      if (
        tag === "Marketing" &&
        /ing,\s+$/i.test(window.slice(Math.max(0, m.index - 12), m.index))
      ) {
        continue;
      }
      add(tag, m.index, m.index + m[0].length);
    }
  }
  const aiBare = /\bAI\b/g;
  let ai: RegExpExecArray | null;
  while ((ai = aiBare.exec(window)) !== null) {
    add("Artificial Intelligence", ai.index, ai.index + ai[0].length);
  }
  return found.toSorted((a, b) => a.start - b.start).map((x) => x.tag);
}

function extractLocations(window: string): string[] {
  const occupied: Array<{ start: number; end: number }> = [];
  const found: Array<{ tag: string; start: number }> = [];
  const seen = new Set<string>();
  for (const { re, tag } of LOCATION_ALIASES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(window)) !== null) {
      if (seen.has(tag)) continue;
      if (overlaps(occupied, m.index, m.index + m[0].length)) continue;
      seen.add(tag);
      occupied.push({ start: m.index, end: m.index + m[0].length });
      found.push({ tag, start: m.index });
    }
  }
  return found.toSorted((a, b) => a.start - b.start).map((x) => x.tag);
}

function overlaps(
  occupied: ReadonlyArray<{ start: number; end: number }>,
  start: number,
  end: number
): boolean {
  return occupied.some((r) => start < r.end && end > r.start);
}

function clipSentence(s: string): string {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ".") continue;
    const next = s[i + 1];
    if (next !== undefined && next !== " " && next !== "\n" && next !== "") continue;
    if (isAbbreviationDot(s, i)) continue;
    return s.slice(0, i + 1);
  }
  return s;
}

function isAbbreviationDot(s: string, dot: number): boolean {
  const before = s.slice(Math.max(0, dot - 8), dot);
  if (/\b(?:U|S|K|C|D|P|R)\s*$/.test(before)) return true;
  if (/(?:Inc|Ltd|Corp|Mr|Ms|Dr|Jr|Sr|vs|eg|ie)$/i.test(before.replace(/\.$/, ""))) return true;
  return false;
}

function locatableSpan(text: string, window: string): string {
  const trimmed = window.replace(/\s+/g, " ").trim();
  if (text.includes(window.slice(0, Math.min(80, window.length)))) {
    const probe = window.slice(0, Math.min(window.length, 200)).trim();
    if (text.includes(probe)) return probe;
  }
  if (text.includes(trimmed)) return trimmed.slice(0, 200);
  return window.slice(0, 80);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
