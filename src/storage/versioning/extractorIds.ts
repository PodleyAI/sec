/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export const EXTRACTOR_IDS = [
  "D",
  "C",
  "CFPORTAL",
  "1-A",
  "1-K",
  "1-SA",
  "253G",
  "1-A-W",
  "1-Z",
  "1-U",
  "QUALIF",
  "3",
  "4",
  "5",
  "144",
  "S-1",
  "424",
  "8-K",
  "merger-proxy",
  "redemption",
  "loi",
  "25-15",
  "RW",
] as const;
/**
 * An extractor's id. Deliberately a plain string, not a union over
 * {@link EXTRACTOR_IDS}: a downstream package registers its own extractors
 * through the form-extractor registry, and a closed union would make that
 * impossible without editing this file. {@link EXTRACTOR_IDS} remains the list
 * sec itself ships — what the CLI offers for completion. `db setup` no longer
 * seeds `component_versions` from it: a closed list cannot name an extractor
 * registered through the open seam, so the ids seeded there are enumerated
 * from that registry instead.
 */
export type ExtractorId = string;

/**
 * The extractors that call `EntityObserver.observePerson`, and so are the only
 * ones a person-normalizer re-key makes stale.
 *
 * `scripts/sql/truncate-identity-tier*.sql` scopes its `extractor_runs` /
 * `extraction_dead_letter` deletes to this set. Clearing those tables wholesale
 * makes the forms sweep re-select EVERY filing, which re-runs the AI extractors
 * that observe no person at all — `8-K` redemption/LOI detection, `merger-proxy`
 * — and re-pays their model cost for nothing.
 *
 * Derived by inspection of the `observePerson` call sites, not from a type: the
 * list is asserted against the SQL scripts by `truncateIdentityTier.test.ts`, so
 * the two cannot drift.
 *
 * - `S-1` — management, executive compensation, beneficial ownership, related party
 * - `D` — related persons
 * - `C` — signatories and officers
 * - `1-A` / `1-Z` — issuer signatories
 * - `3` / `4` / `5` — Section 16 reporting owners
 * - `144` — the selling person
 * - `CFPORTAL` — portal contacts and owners
 *
 * Deliberately absent: `424` and `1-K` observe companies only, `25-15` and `RW`
 * are metadata-only, and `8-K` / `merger-proxy` / `redemption` / `loi` observe the
 * de-SPAC target company rather than any person.
 */
export const PERSON_OBSERVING_EXTRACTOR_IDS: readonly ExtractorId[] = [
  "D",
  "C",
  "CFPORTAL",
  "1-A",
  "1-Z",
  "3",
  "4",
  "5",
  "144",
  "S-1",
] as const;

/**
 * The extractors a `truncate-identity-tier` run must re-extract: every one whose
 * output those scripts delete.
 *
 * Wider than {@link PERSON_OBSERVING_EXTRACTOR_IDS} by exactly `424`, because
 * the scripts wipe the FAMILY tier as well as the person one — and the family
 * tier is not person-scoped. `runOfferingSections` writes `underwriter_link` /
 * `underwriter_family_membership` from the priced 424B1/424B4 path under
 * extractor id `424`, and those link rows ARE the attribution: there is no
 * observation → link projection to rebuild them from, and batch `sec resolve`
 * refuses the family kinds. Scoping the re-extraction gates to the person set
 * alone therefore destroys every 424-sourced underwriter attribution and leaves
 * nothing able to restore it short of `sec extractor backfill 424`.
 *
 * `8-K` / `merger-proxy` / `redemption` / `loi` stay out: the scripts delete no
 * output of theirs, so clearing their runs would re-pay AI cost for nothing.
 */
export const REKEY_REEXTRACT_EXTRACTOR_IDS: readonly ExtractorId[] = [
  ...PERSON_OBSERVING_EXTRACTOR_IDS,
  "424",
] as const;

/**
 * Maps every supported SEC form symbol (including amendment / withdrawal
 * variants) to the canonical extractor id that handles it. The right-hand
 * values match component_versions.component_id rows seeded by
 * bootstrapExtractorVersions().
 */
export const FORM_TO_EXTRACTOR_ID: Readonly<Record<string, ExtractorId>> = {
  D: "D",
  "D/A": "D",
  C: "C",
  "C/A": "C",
  "C-W": "C",
  "C-U": "C",
  "C-U-W": "C",
  "C/A-W": "C",
  "C-AR": "C",
  "C-AR-W": "C",
  "C-AR/A": "C",
  "C-AR/A-W": "C",
  "C-TR": "C",
  "C-TR-W": "C",
  CFPORTAL: "CFPORTAL",
  "CFPORTAL/A": "CFPORTAL",
  "CFPORTAL-W": "CFPORTAL",
  "1-A": "1-A",
  "1-A/A": "1-A",
  "1-A POS": "1-A",
  "1-K": "1-K",
  "1-K/A": "1-K",
  // Reg A semiannual report. Its financial statements are the whole extractor —
  // a 1-SA has no XSD cover page, so there is no issuer or offering data behind
  // it to observe.
  "1-SA": "1-SA",
  "1-SA/A": "1-SA",
  // Offering-circular supplements and withdrawals. Metadata-only: the `024-`
  // link and the rule subsection both arrive in the submissions payload, so no
  // document is fetched for any of the 5,874 filings.
  "253G1": "253G",
  "253G2": "253G",
  "253G3": "253G",
  "253G4": "253G",
  "1-A-W": "1-A-W",
  "1-A-W/A": "1-A-W",
  "1-Z-W": "1-A-W",
  "1-Z-W/A": "1-A-W",
  "1-Z": "1-Z",
  "1-Z/A": "1-Z",
  // Reg A current report — the 8-K analogue. Metadata-only: its item codes
  // arrive in the submissions payload, so the event is known without reading the
  // document.
  "1-U": "1-U",
  "1-U/A": "1-U",
  // The SEC's own qualification notice. Metadata-shaped like 25-15 rather than
  // a filer disclosure, but it carries the authoritative qualification date the
  // issuer-reported field only supplies for ~9% of offerings.
  QUALIF: "QUALIF",
  "3": "3",
  "3/A": "3",
  "4": "4",
  "4/A": "4",
  "5": "5",
  "5/A": "5",
  "144": "144",
  "144/A": "144",
  "S-1": "S-1",
  "S-1/A": "S-1",
  "S-1MEF": "S-1",
  DRS: "S-1",
  "DRS/A": "S-1",
  "F-1": "S-1",
  "F-1/A": "S-1",
  "F-1MEF": "S-1",
  "424A": "424",
  "424B1": "424",
  "424B2": "424",
  "424B3": "424",
  "424B4": "424",
  "424B5": "424",
  "424B7": "424",
  "8-K": "8-K",
  "8-K/A": "8-K",
  DEFM14A: "merger-proxy",
  PREM14A: "merger-proxy",
  DEFM14C: "merger-proxy",
  PREM14C: "merger-proxy",
  DEFR14A: "merger-proxy",
  PRER14A: "merger-proxy",
  // The GENERAL proxy forms. A SPAC's business-combination vote is routinely
  // filed on these rather than on the "M" (merger) variants — 26 Capital's is a
  // plain `DEF 14A` — and skipping them silently drops the proxy stage for the
  // majority of SPACs: across SIC 6770 filers, `DEF 14A` reaches 575 distinct
  // SPACs against `DEFM14A`'s 234, `PRE 14A` 525 and `DEFA14A` 387.
  //
  // Most filings on these forms are NOT merger proxies (annual meetings,
  // director elections, extension votes), which is exactly why routing them
  // here is safe: the merger section is located by the segmenter, so a proxy
  // without one yields no deal rather than an invented one. See
  // `MERGER_PROXY_OPTIONAL_FORMS` — for these forms a missing merger section is
  // the expected case and is skipped quietly instead of dead-lettered.
  "DEF 14A": "merger-proxy",
  "PRE 14A": "merger-proxy",
  // Amendment variants the parser classes also declare; a form the parser
  // supports but the map omits is caught by form-wiring.test.ts.
  "PRE 14A/A": "merger-proxy",
  PRE14A: "merger-proxy",
  PREN14A: "merger-proxy",
  "PREN14A/A": "merger-proxy",
  "PREM14A/A": "merger-proxy",
  // PREC14A/A but NOT PREC14A: the bare code is also declared by
  // Form_PREC14A, which has no parse override and wins resolution, so mapping
  // it would claim a form nothing can parse. The /A amendment is declared only
  // by Form_PRE_14A, which does parse. form-wiring.test.ts checks both
  // directions and is what caught this.
  "PREC14A/A": "merger-proxy",
  DEFA14A: "merger-proxy",
  "DEF 14C": "merger-proxy",
  "PRE 14C": "merger-proxy",
  PREA14C: "merger-proxy",
  // Exchange listing withdrawal (Form 25 / 25-NSE) and Exchange Act
  // deregistration (Form 15 / 15F family). Metadata-only: the filings table
  // already carries cik / form / filing_date, and 25-NSE documents live under
  // the exchange CIK so an issuer-CIK fetch 404s.
  "25": "25-15",
  "25/A": "25-15",
  "25-NSE": "25-15",
  "25-NSE/A": "25-15",
  "15-12B": "25-15",
  "15-12B/A": "25-15",
  "15-12G": "25-15",
  "15-12G/A": "25-15",
  "15-15D": "25-15",
  "15-15D/A": "25-15",
  "15F-12B": "25-15",
  "15F-12B/A": "25-15",
  "15F-12G": "25-15",
  "15F-12G/A": "25-15",
  "15F-15D": "25-15",
  "15F-15D/A": "25-15",
  // Form RW (registration withdrawal). Metadata-only: the filings table already
  // carries cik / form / filing_date. RW WD (undo of a withdrawal) is catalogued
  // but not extracted — reversing a withdrawal is not the same event.
  RW: "RW",
  "SEC STAFF ACTION": "RW",
  // FPI close filing (the 8-K 2.01 equivalent). Metadata-only: classified
  // alongside Form 25/15 so a 20-F after a pending vote / nearby 25-NSE / F-4
  // records `completed` rather than being skipped. An annual 20-F with no
  // close signal is `ignore` and writes nothing.
  "20-F": "25-15",
  "20-F/A": "25-15",
};

/**
 * Forms routed to the merger-proxy extractor on which a MISSING merger section
 * is normal rather than a failure.
 *
 * The "M" forms are merger proxies by definition, so a missing
 * business-combination section there is a real extraction failure worth
 * triaging. The general proxy forms carry every other kind of shareholder vote
 * as well, and most of them legitimately contain no deal — dead-lettering each
 * one would bury the genuine failures under thousands of entries that require
 * no action.
 */
/**
 * General DEFINITIVE proxy / consent statements routed to the merger-proxy
 * extractor. Most SPACs never file a `DEFM14A` at all — across SIC 6770 filers
 * a plain `DEF 14A` reaches 575 distinct SPACs against `DEFM14A`'s 234 — so
 * refusing these drops the proxy stage for the majority of vehicles, and with it
 * every downstream rule anchored on `proxy_date` (the 5.07 vote mapping, the
 * post-approval listing-removal window).
 *
 * Their form symbol says nothing about what the meeting decides, though — most
 * filings on them are annual meetings and charter-extension votes — so the
 * `proxy` lifecycle event is gated on document evidence instead: an extracted
 * deal AND approval-shaped proposal language (`seeksCombinationApproval`). The
 * "M" variants decide on the symbol alone and are deliberately absent, as are
 * the preliminary (`PRE*`), revised (`DEFR14A`/`PRER14A`) and supplemental
 * (`DEFA14A`) statements: only a definitive statement is an approval-stage
 * signal.
 */
export const GENERAL_DEFINITIVE_PROXY_FORMS: ReadonlySet<string> = new Set(["DEF 14A", "DEF 14C"]);

export const MERGER_PROXY_OPTIONAL_FORMS: ReadonlySet<string> = new Set([
  "DEF 14A",
  "PRE 14A",
  "PRE 14A/A",
  "PRE14A",
  "PREN14A",
  "PREN14A/A",
  "PREC14A/A",
  "DEFA14A",
  "DEF 14C",
  "PRE 14C",
  "PREA14C",
]);

/**
 * Section name the merger-proxy extractor records its deal — and every
 * dead-letter entry about it — under. Declared here rather than inside the
 * processor because the selection predicates that key on those entries live
 * elsewhere: a second spelling makes the trace unreadable to them, which is
 * indistinguishable from no trace at all.
 */
export const MERGER_PROXY_SECTION = "merger";

/**
 * Short-form registration statements that incorporate an already-filed
 * prospectus by reference (Securities Act Rule 462(b)).
 *
 * They register additional securities for an offering whose full prospectus is
 * already on file, so the document is a cover page and signatures — no
 * management roster, ownership table or risk factors. Sweeping them for those
 * sections dead-letters every one as SECTION_NOT_FOUND and reports the filing
 * `partial`, which is noise: nothing is missing.
 */
export const SECTIONLESS_REGISTRATION_FORMS: ReadonlySet<string> = new Set(["S-1MEF", "F-1MEF"]);

export function formToExtractorId(form: string): ExtractorId | undefined {
  return FORM_TO_EXTRACTOR_ID[form];
}

/**
 * The extractors whose storage handlers are gated on an existing `spac` row and
 * record a SUCCESSFUL run when they find none — writing nothing while looking
 * processed to every anti-join.
 *
 * A sweep that reaches these before the registration statement that mints the
 * row therefore drops their events permanently. `sortFormsForSweep` keeps a
 * single sweep in dependency order; this set is what lets `spac process`
 * re-select a filing that was gated in an EARLIER sweep, once the row exists.
 */
export const SPAC_ROW_GATED_EXTRACTORS: ReadonlySet<string> = new Set([
  "8-K",
  "merger-proxy",
  "25-15",
]);

export function isSpacRowGatedExtractor(extractorId: string): boolean {
  return SPAC_ROW_GATED_EXTRACTORS.has(extractorId);
}

/**
 * Ownership forms are off the SPAC timeline's critical path (S-1 → 424 → 8-K →
 * proxy → 25/15). A fetch miss on Form 3/4/5/144 must not fail `spac process`.
 */
export const NONFATAL_TIMELINE_EXTRACTOR_IDS: ReadonlySet<string> = new Set(["3", "4", "5", "144"]);

export function isNonfatalTimelineExtractor(extractorId: string): boolean {
  return NONFATAL_TIMELINE_EXTRACTOR_IDS.has(extractorId);
}

/**
 * Order the forms sweep must drain its extractors in.
 *
 * The SPAC tier is a chain of gates: the registration statement mints the
 * `spac` row, the prospectus records the IPO, and the 8-K, merger-proxy and
 * 25/15 handlers are all known-SPAC gated on that row — each one recording a
 * SUCCESSFUL run when it finds no row, so the ordinary `extractor_runs`
 * anti-join never revisits it. A sweep that reaches them first therefore drops
 * their events permanently rather than deferring them.
 *
 * Forms not listed here have no such dependency and run afterwards. Applied by
 * `sortFormsForSweep` in `formsSweepOrder.ts`, which ranks a form through the
 * form-extractor registry and so cannot live in this import-free module.
 */
export const SWEEP_PRIORITY: readonly ExtractorId[] = [
  "S-1",
  "RW",
  "424",
  "8-K",
  "merger-proxy",
  "25-15",
];
