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
  "253G",
  "1-A-W",
  "1-Z",
  "1-U",
  "QUALIF",
  "rega-financials-1sa",
  "3",
  "4",
  "5",
  "144",
  "S-1",
  "S-1-xbrl",
  "424",
  "424-xbrl",
  "8-K",
  "8-K-items",
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
 * impossible without editing this file. {@link EXTRACTOR_IDS} is the vocabulary
 * the CLI offers for completion, which is NOT the same as the readings this
 * package ships: an id whose whole reading is a consumer's still belongs here
 * once one of this package's own sweeps has to name it. `db setup` no longer
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
 * The extractors whose output the re-key ceremony deletes, and which therefore
 * have to run again after it.
 *
 * The person-observing set exactly: the scripts here wipe `person_observations`
 * and everything keyed to one, and nothing else an extractor wrote.
 *
 * The FAMILY tier is a different package's, and so is its ceremony. Its link
 * rows ARE the attribution — no observation → link projection rebuilds them —
 * so the script that wipes them carries its own gate list, including the `424`
 * that writes `underwriter_link` from the priced-prospectus path. Naming `424`
 * here as well would clear its runs on a deployment whose family tier this
 * ceremony never touched, re-paying model cost for nothing.
 *
 * `8-K` / `merger-proxy` / `redemption` / `loi` stay out for that same reason:
 * the scripts delete no output of theirs.
 */
export const REKEY_REEXTRACT_EXTRACTOR_IDS: readonly ExtractorId[] = PERSON_OBSERVING_EXTRACTOR_IDS;

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
 *
 * The registration, prospectus and current-report families carry two
 * extractors each — the structured reading this package ships and the reading
 * of the same filing a consumer may add — and the rank is read off whichever
 * leads. Both spellings are listed and adjacent, so the family sorts to the
 * same place whichever is registered first.
 */
export const SWEEP_PRIORITY: readonly ExtractorId[] = [
  "S-1-xbrl",
  "S-1",
  "RW",
  "424-xbrl",
  "424",
  "8-K-items",
  "8-K",
  "merger-proxy",
  "25-15",
];
