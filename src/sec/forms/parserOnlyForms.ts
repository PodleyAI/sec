/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { allRegisteredExtractorIds, formHasExtractor } from "./formExtractors";

/**
 * Forms this package can PARSE but ships no extractor for, grouped under the
 * extractor id whichever package supplies that reading registers.
 *
 * A parser with no extractor is a legitimate state, not a wiring defect: it
 * says this package understands the document and nothing here reads it. The
 * proxy family is the case — the classes that turn a proxy statement into a
 * parse live here, and the reading that turns one into a deal is a consumer's.
 *
 * The listing-removal and registration-withdrawal families are the same case
 * read off metadata rather than off a document: a Form 25, Form 15 or RW says
 * a registration ended, and what that MEANS — unit separation, a de-SPAC close,
 * a liquidation, an abandoned IPO — is a judgement inside a lifecycle model
 * that a consumer supplies. The `20-F` is here for the same reason it was ever
 * routed to `25-15`: the FPI close is a listing-removal reading of it, and this
 * package has no other reading of the form.
 *
 * PINNED, and asserted in both directions by `form-wiring.test.ts`: every
 * parse-supported form with no registered extractor must appear here, and
 * every form here must still be parse-supported. A form quietly dropping out
 * of extraction is exactly what that invariant exists to catch, so this list
 * cannot grow — or go stale — without the suite saying so.
 *
 * The id is what a consumer registers under, not a guess: `EXTRACTOR_IDS`,
 * `SWEEP_PRIORITY`, `SPAC_ROW_GATED_EXTRACTORS` and `SYNC_FORM_DOMAINS` all
 * already name it, and this package still holds the tables its runs wrote.
 */
export const PARSER_ONLY_FORMS_BY_EXTRACTOR = {
  "merger-proxy": [
    "DEFM14A",
    "PREM14A",
    "DEFM14C",
    "PREM14C",
    "DEFR14A",
    "PRER14A",
    "DEF 14A",
    "PRE 14A",
    "PRE 14A/A",
    "PRE14A",
    "PREN14A",
    "PREN14A/A",
    "PREM14A/A",
    "PREC14A/A",
    "DEFA14A",
    "DEF 14C",
    "PRE 14C",
    "PREA14C",
  ],
  "25-15": [
    "25",
    "25/A",
    "25-NSE",
    "25-NSE/A",
    "15-12B",
    "15-12B/A",
    "15-12G",
    "15-12G/A",
    "15-15D",
    "15-15D/A",
    "15F-12B",
    "15F-12B/A",
    "15F-12G",
    "15F-12G/A",
    "15F-15D",
    "15F-15D/A",
    "20-F",
    "20-F/A",
  ],
  RW: ["RW", "SEC STAFF ACTION"],
} as const satisfies Record<string, readonly string[]>;

/** Every form {@link PARSER_ONLY_FORMS_BY_EXTRACTOR} declares, flattened. */
export const PARSER_ONLY_FORMS: ReadonlySet<string> = new Set(
  Object.values(PARSER_ONLY_FORMS_BY_EXTRACTOR).flat()
);

/**
 * The extractor id declared for `form`, or undefined when the form is not one
 * this package parses without reading.
 */
export function parserOnlyExtractorIdForForm(form: string): string | undefined {
  for (const [id, forms] of Object.entries(PARSER_ONLY_FORMS_BY_EXTRACTOR)) {
    if ((forms as readonly string[]).includes(form)) return id;
  }
  return undefined;
}

/**
 * Whether `id` names an extractor declared above that NOTHING in this
 * deployment registers — so a command naming it can reach no filing at all,
 * however many are stored.
 *
 * Asked of the registry rather than of the declared forms, because a consumer
 * may register the id over forms this package never listed (a de-SPAC `S-4`
 * carries the same reading). Anything registered under the id means the
 * package supplying it is present and its backfill has real work to resolve.
 */
export function extractorIsSuppliedElsewhere(id: string): boolean {
  if (!Object.hasOwn(PARSER_ONLY_FORMS_BY_EXTRACTOR, id)) return false;
  return !allRegisteredExtractorIds().includes(id);
}

/**
 * Why `form` cannot be processed here, in the terms an operator can act on: a
 * form nobody reads is one thing, and a form this package parses whose reader
 * ships elsewhere is another.
 */
export function noExtractorReason(form: string): string {
  const id = parserOnlyExtractorIdForForm(form);
  if (id === undefined) return `no extractor is registered for form '${form}'`;
  return (
    `no extractor is registered for form '${form}': this package parses it, but the ` +
    `'${id}' extractor that reads it is supplied by a consumer package`
  );
}

/** Forms already warned about in this process. */
const warned = new Set<string>();

/**
 * Warn ONCE per form per run that nothing here reads it.
 *
 * Per form and not per filing: a sweep that meets a form it cannot read meets
 * it once for every filing of that form, and a warning printed thousands of
 * times is one an operator scrolls past. The dedupe is process-wide because a
 * run IS a process — the CLI runs each one as a child of the same binary.
 */
export function warnFormHasNoExtractor(form: string): void {
  if (warned.has(form)) return;
  warned.add(form);
  console.warn(`forms: ${noExtractorReason(form)}; skipping every filing of it in this run.`);
}

/** Test hook: forget which forms have been warned about. */
export function resetNoExtractorWarningsForTesting(): void {
  warned.clear();
}
