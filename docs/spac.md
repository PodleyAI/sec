# SPAC lifecycle model

Reference for the `spac` consolidated report, its append-only source tables, the
extractors that feed it, and the candidate screen.

---

## 1. The `spac` row is derived, not written

A CIK-keyed `spac` row consolidates the lifecycle for a quick report: status, three-era
names/SIC/tickers (`spac_*` / `post_merger_*` / `current_*`), amounts (`ipo_proceeds`,
`trust_amount`, `current_trust_amount`, `pipe_amount`, `total_redemption_amount`), and
rolled-up key dates.

It is **derived** from two append-only tables — `spac_deal` (one row per
business-combination attempt) and `spac_event` (the dated timeline) — so replays are
idempotent. An `as_of` guard protects filing-sourced scalar fields from out-of-order
writes, and `spac_history` + `ChangeLog` version the row.

```bash
sec spac report <cik> [--format json]
sec spac history <cik> [--format json]
```

---

## 2. IPO: a vehicle IPOs once

The IPO half is populated from S-1/DRS (`registration`) and priced 424B1/424B4 (`ipo`).

The `spac` row is deliberately kept past the combination — the shell keeps its CIK and
renames, which is what the three name eras model — and EDGAR keeps coding the surviving
operating company 6770 for years. So when that company files a 424B4 of its own, both of
`isSpac`'s signals still read true. **Two gates** stop it being treated as a SPAC unit IPO:

- `isSpac` is false once `status` is terminal (`completed` / `liquidated` / `withdrawn`) —
  this is what keeps the follow-on's terms out of `spac_unit_terms`, since `isSpac` picks
  the destination table and gates sponsor-promote extraction;
- `recordSpacIpoEventIfEligible` refuses when an `ipo` event already exists under a
  **different accession** — the backstop for a vehicle whose `completed` event has not
  landed yet. Keying on the accession rather than on `ipo_date` is what keeps a replay of
  the same filing working across a version bump or a dead-letter retry.

`ipo_date` is written only by `recordIpo`, which `processForm424` runs for a priced
prospectus (424B1/424B4, or a 424B3 that is the vehicle's IPO prospectus) filed by a CIK
that either carries a 6770 SGML header or already has a **non-terminal** `spac` row. A row
minted by the S-1 AI content classifier legitimately has none until its own priced
prospectus lands — which is why every rule below treats an **unknown `ipo_date` as
non-evidence** rather than as a demotion.

### Recovering a database that ingested follow-ons before those gates

It carries duplicate `ipo` events and repriced IPO figures. Find them with a
`GROUP BY cik HAVING COUNT(*) > 1` over `spac_event` where `event_type = 'ipo'`.
`spac.ipo_proceeds` is recoverable from the earliest `ipo` event's `amount`, but
`trust_amount` and `spac_tickers` are not on the event and need
`sec extractor backfill 424 --force` — which first requires the affected rows' `as_of` to be
cleared along with those three columns. Otherwise `buildSpacRow` marks the true IPO filing
stale (`filingDate < existing.as_of`) and `pick()` refuses to clobber a non-null, so the
re-run silently leaves the follow-on's numbers in place. Leave `spac_history` alone: it is
the audit trail of what the row said.

---

## 3. De-SPAC milestones from 8-K item codes

Known SPACs only — a `spac` row must already exist. The mapping is **not 1:1**: the same
item code carries a de-SPAC milestone on one filing and ordinary housekeeping on the next,
so `mapItemCodesToSpacEvents` classifies each code into a lifecycle type or a non-lifecycle
one (`material_agreement` / `eight_k`, which no deal walk reads).

| Item   | Lifecycle type         | Condition                                                                                        |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `2.01` | `completed`            | unconditional                                                                                    |
| `1.01` | `definitive_agreement` | submission carries a merger-shaped EX-2 exhibit AND the event is not dated before the date floor |
| `1.02` | `terminated`           | a deal was pending as of that filing, or the exhibits are merger-shaped                          |
| `5.07` | `vote`                 | a deal was pending as of that filing AND it had a proxy date                                     |

**Item `8.01` carries no lifecycle mapping at all** — `mapItemCodesToSpacEvents` falls
through its `default: break`. A termination disclosed only under 8.01 (a common way to
announce a dead deal) therefore leaves the attempt `pending` indefinitely.

The date floor is `ipo_date`, falling back to `registration_date`, and exists only to reject
the SPAC's own pre-IPO underwriting and formation agreements. The real discriminator is the
EX-2 exhibit.

> **The pending-deal hint is computed from the event stream strictly BEFORE this accession**
> (`pendingDealBefore`), never from the currently derived deal set. That is what makes replay
> idempotent, and it is easy to reintroduce: reading the derived deals makes filing N's
> classification depend on filings that came after N, so reprocessing N demotes its lifecycle
> event — and `recordDealMilestones` replaces every item-mapped row for the accession before
> appending, so the demotion deletes the event the first pass wrote.

Classified events group into `spac_deal` attempts via `deriveDeals`, recomputed from the
event stream on every write so `deal_index` is stable across replays. `target_name`,
`pipe_amount` and redemption amounts stay null until the narrative extractors land — 8-K
item codes carry no names or amounts.

---

## 4. Deregistration vs unit separation (Form 25 / 25-NSE / Form 15)

Extractor id `25-15`; metadata-only.

An **exchange 25-NSE within 180 days of IPO** is unit separation — units stop trading so
shares/warrants/rights can trade separately (Nasdaq often files one 25-NSE per class; a
second in that window is still a split). It writes a `unit_split` event, fills
`unit_split_date`, and advances status `ipo` → `searching`. It does **not** fail the vehicle
and does not close a pending deal.

Issuer Form 25, the Form 15 family, and a 25-NSE **after** that window write
`deregistration`, which closes a leftover pending deal and fails the vehicle.

### A pending deal only makes a listing removal a close inside the approval window

`LISTING_REMOVAL_MAX_DAYS_AFTER_APPROVAL` is 90 calendar days, anchored on the **later** of
the proxy or vote (a superseding proxy revives an attempt). Reaching the ballot is not
closing: a deal can die after its vote, and when that is disclosed only under Item 8.01 —
which writes no lifecycle event — the attempt stays `pending` with its `vote_date` forever,
so an unbounded "has a proxy or vote" test read the eventual wind-up's Form 25 / Form 15 as
a completed combination. A 5.07 extension meeting also maps to `vote` whenever a deal is
pending, so a `vote_date` does not even mean the merger was approved.

A real post-approval close is days: the widest pairing in the committed corpus is **40 days**
(Columbus Circle, proxy 2025-11-12 → Form 15 2025-12-22), the rest 2, 3, 6, 8, 10 and 19. The
window is **one-sided** — a removal filed before the approval is not housekeeping for it. The
same bound governs the 20-F branch.

### An unknown IPO floor does not demote a 25-NSE

Classifying a SIC-miscoded SPAC's routine post-IPO unit separation as `deregistration` marked
a live searching vehicle permanently `liquidated`. So an exchange 25-NSE with an absent
`ipo_date` writes `unit_split`; a KNOWN `ipo_date` keeps the 0–180 day window and still
deregisters outside it.

**The allowance is applied after the nearby-20-F FPI-close check, not inside the post-IPO
window test, and the ordering is load-bearing**: an FPI close carries no `ipo_date` either, so
letting an unknown floor claim `unit_split` first would misfile every miscoded FPI close as a
unit separation. The 20-F check gets first refusal on the same filings.

The allowance is **exchange-only** — issuer Form 25 and the whole Form 15 family deregister
regardless, because a real wind-up files exactly those. It is self-correcting (once the 424
lands, `deregistrationDescriptor.filterTodo` re-derives the kind and re-queues, and
`recordDeregistration` deletes the sibling `unit_split` on the same accession before
appending — symmetric in both directions), and inert in the rollup with no `ipo` event, since
`deriveStatus` reads `unit_split` only inside its `hasIpo` branch: status stays `registered`
and `unit_split_date` is filled without claiming an IPO.

A deregistration ordered at or before a `completed` event is **post-close housekeeping and
does not fail the deal** — the completion is dated by the 8-K's REPORT date while the Form 25
event is dated by its FILING date, so the routine delisting of a de-SPAC'd shell's units
routinely collides with or sorts ahead of the closing it follows. `deriveDeals` therefore
ignores liquidation/deregistration entirely when the stream carries a completion anywhere.

### Sweep ordering and the `25-15` fixpoint

The whole 8-K / proxy / 25-15 tier is gated on the `spac` row the registration statement
mints, and **each handler records a successful run when the row is missing** — so a sweep
reaching them first drops their events with nothing to re-select the filing.
`sortFormsForSweep` (`storage/versioning/extractorIds.ts`) gives `sec sync` form-domain
leaves an explicit registration → prospectus → 8-K → proxies → 25/15 order rather than
relying on `Object.keys` (which enumerates the integer-like `"25"` fourth).

```bash
sec extractor backfill 25-15    # repeat until it reports `processed 0`
```

No `--force` is needed — `filterTodo` already selects known-SPAC Form 25/15 filings with no
`deregistration` or `unit_split` event. **Run it until `processed 0`**: `filterTodo`
re-derives each accession's kind against the live classifier and `hasPriorCompleted` reads
the event stream, so a stale `completed` on an EARLIER accession keeps a later one
classifying `completed` and skipped. Only after the earlier accession is corrected does the
next pass see the later one.

---

## 5. De-SPAC linkage and current trust

When a deal reaches `completed`, the issuer is linked to its post-merger surviving entity.
`buildSpacRow` derives `surviving_name` from the completed deal's `target_name` (the combined
company is named after the target) and promotes it onto `current_name`. On the item-2.01 8-K,
`SpacReportWriter.recordDeSpacLinkage` additionally reads the SPAC CIK's own post-close
`entity` / `entity_tickers` metadata — the shell keeps its CIK and renames, so `current_cik`
stays null (it differs only for the deferred newco/S-4 case) while `surviving_name` /
`post_merger_sic` / `post_merger_tickers` come from the renamed entity, each set only when it
diverges from the SPAC-era value so replays are order-safe.

Entity metadata usually refreshes _after_ the 2.01 8-K, so `sec spac backfill-despac` re-runs
the linkage over every completed SPAC to fill still-null slots.

**All five derived columns are strictly derived from a completed deal, never merged forward.**
A rebuild whose event stream no longer derives one drops them and the `current_*` chains
collapse back to the `spac_*` mirror — so a filing reclassified from `completed` to
`deregistration` cannot leave a wound-up shell reading as the operating company forever. All
five are in `TRACKED_FIELDS`, so the correction is captured in `spac_history` / `ChangeLog`.

**Current trust.** `trust_amount` is the IPO-day deposit. The live balance (interest,
extension deposits, redemptions) is `current_trust_amount` / `current_trust_as_of`, lifted
from company facts tagged `AssetsHeldInTrust*` on 10-Q/10-K. `sec sync facts` refreshes a CIK
as it stores; `sec spac backfill-trust` sweeps every known SPAC. The filing `as_of` anchor is
not moved, so IPO scalars stay order-safe.

```bash
sec spac backfill-despac [--dry-run]
sec spac backfill-trust  [--dry-run]
```

---

## 6. Merger proxies

`DEFM14A`/`PREM14A`, the `DEFM14C`/`PREM14C` consent statements, and the `DEFR14A`/`PRER14A`
revised proxies (extractor id `merger-proxy`) run `processMergerProxy` — known SPACs only. AI
extraction over the merger / business-combination / PIPE sections records a per-accession
`spac_merger_extraction` row (target name/CIK, PIPE amount, merger consideration) and observes
the target company (`relation: "merger-proxy:target"`).

`deriveDeals` correlates each extraction onto the matching `spac_deal` by filing-date window,
_deriving_ `target_name` / `target_cik` / `pipe_amount` (a later filing supersedes an earlier
one — definitive over preliminary, revised over definitive), which retires the 8-K path's
positional merge-preserve. Preliminary and revised proxies are extraction-only. S-4 is
deferred (newco-CIK linkage).

### Announced deal values

The extractor also reads `equity_value` and `enterprise_value` of the combined company,
correlated by the same window. They exist because a completed combination is otherwise
unvaluable: the market never priced the target, and its book equity is a private company's
accounting rather than what was paid for it.

**A figure written in the units of its own sentence is dropped, never stored and never
rescaled** (`dealValueScale.ts`, floor `MIN_PLAUSIBLE_DEAL_VALUE` = $10,000,000). A prospectus
says "$1.4 billion" and a model can answer `1.4`, or `1400`; both validate against the schema,
both store, and both become a valuation off by a factor of a million that nothing downstream
re-derives. The floor separates the two populations with nothing near it — a real combination
is tens of millions at minimum (the trust alone is), and a scaled figure is single or
quadruple digits. Rescaling would be a second model of the filing, and a wrong guess is
indistinguishable from a right one once stored; a null says what is true. The prompt states
the unit at the point the number is produced, which is the other half of the fix.

Both fields are `Type.Optional` on the model schema, so a replay under an older extractor
version still validates. Adding them is a **minor bump**:

```bash
sec version start-dev extractor merger-proxy --minor
sec version promote extractor merger-proxy
sec extractor backfill merger-proxy --force
```

`--force` is **required** here and is not the usual belt-and-braces. The merger-proxy
descriptor REPLACES the default extractor-runs anti-join rather than widening it (it has to:
the known-SPAC gate records a successful no-op run), so its `filterTodo` selects only proxies
with no extraction row and general definitive proxies whose approval verdict is still NULL. A
version bump moves nothing into either set, so without `--force` the ceremony reports
`processed 0` and every already-extracted proxy keeps a null `equity_value` forever.

### Which statements emit the `proxy` event

The `proxy` event (→ `proxy_date` / `status = proxy`) is **two-tier**, and the tiers differ in
what counts as evidence:

- **Definitive merger statements** `DEFM14A` / `DEFM14C` emit on the form symbol alone — the
  symbol says the meeting is about a combination, so the event still lands when the merger
  section is absent or low-confidence. (A consent deal has no `8-K 5.07` vote, so the
  definitive 14C is its only approval-stage signal.)
- **General definitive statements** `DEF 14A` / `DEF 14C` — where most SPACs actually vote
  their combination — emit only on **two conjunctive** pieces of document evidence: an
  extracted deal AND `seeksCombinationApproval`
  (`proxies-information-statements/seeksCombinationApproval.ts`), a deterministic scan for a
  numbered proposal item naming the filer's defined `Business Combination Proposal`, or a
  request to approve/adopt the **agreement**.

The extracted deal alone is not evidence, because an **extension** proxy recites the announced
combination at length: `S1_SECTIONS.BUSINESS_COMBINATION` accepts a bare
`The Business Combination` heading, so the section is found and the model returns a target.
That is a silent corruption, not a missing row — a `proxy` event OPENS a deal by itself in
`spacDealGrouping.ts`, which makes the vehicle's next item `5.07` a merger `vote`, which makes
any Form 25/15 inside the 90-day window a `completed` de-SPAC, with `surviving_name` promoted
onto `current_name`.

**The gate is deterministic rather than a model schema field.** The failure costs are
asymmetric: a false positive corrupts the primary answer with no trace, while a false negative
only degrades a fallback — a real close files an Item 2.01, which maps to `completed`
unconditionally. A model field also could not repair existing rows without re-paying the AI
bill, and making it required would force an extractor version cycle.

Two rules the patterns must keep, both measured over 348 real SIC-6770 `DEF 14A` / `DEF 14C`
statements (9 merger proxies, 339 other; the rule scores 9/9 recall at **0 false positives**):

- **Never match the term anywhere in the document.** Every extension proxy carries "as if they
  had voted against a business combination proposal". A whole-document test for
  `business combination proposal` fired on 24 of the 348, **all** extension or annual
  meetings. Both patterns are therefore line-shaped (≤ 300 chars) and the defined-term one is
  anchored at line start.
- **The approval object must be the AGREEMENT.** A bare `to approve … business combination` is
  the standard extension wording.

There is deliberately no extension-exclusion term: a proxy asking for an extension AND for
approval of the combination is a genuine merger proxy and must still emit.

Extraction is unchanged either way — the `spac_merger_extraction` row is written whether or
not the gate passes — and the verdict is recorded on it as `seeks_combination_approval`.
`NULL` means the gate was not evaluated (the row predates it, or the form symbol alone
decides). The backfill keys on that NULL, so it must stay distinguishable from a recorded
`false`.

### Retraction, and why the writer takes a tri-state

`recordMergerProxy` deletes a `proxy` event for the accession when the caller now decides the
filing is not approval-stage, mirroring the sibling deletes in `recordDeregistration` /
`recordUnitSplit` / `recordCompleted`. Reclassification runs in both directions and a replay
demotes the deal instead of leaving the old verdict standing. The delete is scoped to that one
accession.

**Only a verdict about the DOCUMENT moves the event** — hence `ProxyEventVerdict`
(`emit | retract | leave`, decided by `resolveProxyEventVerdict`) rather than a boolean.
`runSection` contains every model and transport failure as a dead letter and returns normally,
so "the model said this filing discloses no deal" and "the provider throttled us" both arrive
as an unset `extractedDeal`. Read as a boolean, the second retracted a `proxy` event an
earlier successful run had recorded from real evidence — and losing it takes the whole
approval stage with it, since the vehicle's next Form 25/15 then classifies `deregistration`
and `recordDeregistration` deletes the `completed` event: a genuinely de-SPAC'd vehicle
recorded as a wind-up, from a run that merely could not reach a model.

So a general definitive statement retracts only on `seeks_combination_approval === false`
(deterministic, and conjunctive with the deal, so it decides alone and keeps the recovery
ceremony working during a provider outage) or on a dead letter that IS an answer
(`SECTION_NOT_FOUND` / `MODEL_EMPTY`, `NO_DEAL_REASONS`). Everything else — including
`LOW_CONFIDENCE_ALL` and `UNVERIFIED_SOURCE_SPAN`, where the model did return a deal and only
its certainty or citation failed — leaves the stream untouched.

The deterministic verdict is recorded on an existing extraction row **even when the run
extracted nothing** (`SpacMergerExtractionRepo.recordApprovalVerdict`), because the gate really
was evaluated — it is a property of the document, not of the model call. Left NULL, the
backfill's null-verdict clause re-selects the same filing on every sweep. No row is invented
where none exists: every predicate downstream reads an extraction row as "this proxy produced
something".

### Recovery ceremony

Databases populated before the gate existed carry false closes. Re-run the proxies, then let
the listing-removal classifier re-derive the verdicts built on them:

```bash
sec extractor backfill merger-proxy   # re-derives the verdict; retracts stale proxy events
sec extractor backfill 25-15          # repeat until it reports `processed 0`
```

The first re-selects exactly the general definitive proxies whose `seeks_combination_approval`
is still NULL, and extinguishes itself once each has a verdict.

Find the affected rows first:

```sql
SELECT cik, accession_number, event_date, form FROM spac_event
WHERE event_type = 'proxy' AND form IN ('DEF 14A','DEF 14C') ORDER BY cik, event_date;

SELECT p.cik, c.accession_number AS close_accession, c.form, c.event_date
FROM spac_event p JOIN spac_event c ON c.cik = p.cik AND c.event_type = 'completed'
WHERE p.event_type = 'proxy' AND p.form IN ('DEF 14A','DEF 14C')
  AND c.form IN ('25','25/A','25-NSE','25-NSE/A','15-12B','15-12G','15-15D','20-F','20-F/A');
```

> ⚠️ Expect status **regressions** on real CIKs as the false closes unwind — `completed` back
> to `searching` / `deal_announced`, and the derived post-merger columns dropping back to the
> `spac_*` mirror. That is the correction, not a loss: every change is captured in
> `spac_history` / `ChangeLog`, and genuinely completed SPACs are re-filled by
> `sec spac backfill-despac`.

A proxy ingested before its issuer's `spac` row exists hits the known-SPAC gate and no-ops,
recording a successful run, so the normal sweep never revisits it.
`sec spac backfill-merger-proxies` recovers these.

```bash
sec fetch form <cik> DEFM14A
sec spac backfill-merger-proxies
sec extractor dead-letters merger-proxy
sec extractor retry-dead-letters merger-proxy
```

---

## 7. Redemptions and letters of intent

**Redemption actuals** (extractor id `redemption`) are AI-extracted from a known SPAC's
post-vote 8-K narrative. When an 8-K carries item `5.07`, `2.01` or `8.01` for a known SPAC,
ingestion escalates the fetch to the full submission `.txt` and reads the primary document
plus `EX-99.x` exhibits. `processRedemption8K` records a per-accession
`spac_redemption_extraction` row, and `deriveDeals` correlates `redemption_amount` /
`redemption_shares` onto the matching deal. **The deal column is the sole source
`total_redemption_amount` sums**, so redemptions are counted once.

**Letters of intent** (extractor id `loi`) bring back the LOI stage (between `searching` and
`deal_announced`). No 8-K item code carries an LOI, so `processLoi8K` AI-detects
"non-binding letter of intent / agreement in principle / MOU for a business combination"
language in a known SPAC's 8-K narrative (items `1.01`, `7.01`, `8.01` escalate the fetch,
sharing the redemption path's escalation). A verified positive records a
`spac_loi_extraction` row and emits an `loi` event (dated by the narrative's LOI date, else
the report/filing date); `deriveDeals` opens/dates the attempt and the rollup lifts
`loi_date` / `status = "loi"`. A later definitive agreement supersedes the LOI stage.

For both, "nothing reported" is the expected answer for most trigger 8-Ks, so the
`MODEL_EMPTY` dead letter is auto-resolved. Genuine problems — low confidence, unverified
span, nonce mismatch, and the `MODEL_INVALID_OUTPUT` catch-all — stay **pending**. Because the
detector records a **successful** run row even for a section that threw, the ordinary sweep
will not re-select the filing and the pending entry is the only trace; the backfill commands
re-select exactly those filings (a catch-all entry in any status with no extraction row)
alongside the ones that never ran.

```bash
sec spac backfill-redemptions
sec spac backfill-lois
sec extractor dead-letters redemption|loi
sec extractor retry-dead-letters redemption|loi
```

The LOI prompt is scored through the eval harness — the `loi` entry in `EVAL_EXTRACTORS` plus
eight golden 8-K narratives (three positives, five confusable negatives). See `docs/eval.md`.

---

## 8. AI SPAC content classifier (SIC-miscoded SPACs)

Deterministic SPAC classification keys off the SGML-header SIC (`6770` → `is_spac`,
`classifier_source = "sgml-header"`), but the header alone is not sufficient in either
direction.

### A stale 6770 is downgraded

A **post-de-SPAC** registration statement carries a stale 6770 because the surviving operating
company keeps the shell's CIK and EDGAR keeps coding the filer for years. `Ionetix Corp / DE /`
— filed as `JDEV Acquisition Corp` — filed a 2026 S-1 under a `BLANK CHECKS [6770]` header
carrying 1,844 XBRL facts of real operating financials, and minting a known-SPAC row for it
gates the entire 8-K / merger-proxy / Form 25-15 tier onto a company that already completed
its combination.

So a 6770 header is **downgraded** (`classifier_source = "sgml-header-rejected"`) when the
prospectus summary does not read like a blank check. Four limits keep the demotion honest:

- **It reads the SUMMARY, not the whole document.** A de-SPAC prospectus recounts its own SPAC
  history at length, so the raw-HTML heuristic would pass exactly the filings this is meant to
  catch.
- **Only a substantial summary can demote** (2k characters; the smallest in the committed
  corpus is ~13.6k). Silence is evidence only where there was room to speak — a summary stub
  says nothing about anything, and demoting on it would turn a segmentation shortfall into a
  classification.
- **It never demotes a CIK that already has a `spac` row.** A CIK that once registered as a
  blank check stays a SPAC CIK for good — the shell keeps its CIK through the combination and
  renames, which is what the row's three eras model. The content gate is only for a CIK
  nothing knows about yet, where the question is whether to MINT a row on a stale header.
- **It demotes only on a summary carrying ZERO blank-check signals**, not the two
  `looksLikeBlankCheck` defaults to. The two callers ask the same question with opposite error
  costs (a false negative in the AI pre-filter skips a model call; here it deletes the `spac`
  row), and at 2 it demoted `Lucent, Inc.` — a shell whose summary states outright that it is
  a blank check company, that phrase being its only signal because a shell that size has no
  trust account, no founder shares and no sponsor. Across the committed corpus all 20 labelled
  SPAC summaries carry ≥2 signals and every non-SPAC filed under a 6770 header carries zero.

### A miscoded or absent SIC gets a second chance

A SPAC filed under a miscoded or absent SIC would be missed, so `processFormS1` runs an AI
content classifier behind the `S1Classification.classifier_source = "ai"` seam. It is gated
twice to stay cheap: only when the deterministic path did **not** already flag the filing, and
only when the cheap keyword heuristic (`looksLikeBlankCheck`, `s1/spacContentHeuristic.ts` —
≥2 distinct blank-check signals) trips on the prospectus-summary prose.

A confident `spac` verdict (`extractSpacClassification` distinguishes a true SPAC from a
`shell` or `operating` company) flips the local `is_spac`, overwrites the classification row
with `classifier_source = "ai"`, and mints the known-SPAC `spac` row so de-SPAC lifecycle
extractors can attach. A confident "not a SPAC" is the expected outcome and auto-resolves its
`MODEL_EMPTY` dead letter; when the model is unavailable, a blank-check-looking filing
dead-letters `spac-classification` (`MODEL_RESOLUTION_ERROR`) so a retry runs it once a model
exists.

---

## 9. The `spac_candidate` screen

`spac` is populated by the S-1 extractor, which needs the filing document. `spac_candidate` is
the cheap screen running off **submissions metadata alone** — no document fetches — so a
usable list exists the moment submissions are ingested, and the forms sweep has a worklist to
aim at.

```bash
sec sync spacs identify [--full]
sec spac candidates [--confidence high] [--limit n] [--format csv|json]
sec spac download registration|8k|everything [--confidence high,medium] [--force]
```

### Four signals, kept as separate columns

So a consumer can re-derive its own rule: `entities.sic = 6770`; a blank-check-shaped current
name; a blank-check-shaped _former_ name; and `signal_filed_sic_6770` — whether a registration
this filer filed carried a **6770 header SIC as filed**.

That last one is **the only signal a completed de-SPAC cannot erase**: it recodes AND renames,
so the other three vanish together (Joby, Opendoor, Hippo, E2open, Markforged and Banzai each
fell out of the screen entirely), while the registration statement's own header still reads
6770 forever. It is read from `s1_classification.sic`, where `processFormS1` already writes the
value it parsed out of the SGML header — no second copy, and no column on `filings` for the
next submissions refresh to overwrite with null. `null` means no registration of this filer has
been parsed yet, which is not the same as false.

### Confidence grades

- **high** — an S-1-family registration (`S-1`/`F-1`/`DRS` + amendments) plus either a
  blank-check name (current or former), EDGAR's 6770 coding, or a registration filed under a
  6770 header, with nothing arguing against it. The as-filed header sits on this rung because a
  registration filed under it IS a blank-check IPO by construction — a stronger claim than the
  current-SIC signal, which only says the filer reads 6770 today. The name half survives the
  de-SPAC, which is exactly where `sic = 6770` fails (DraftKings reads 7990 today, Lucid 3711).
  6770-plus-registration sits here on measurement: 150 of 168 such 2019–2024 registrants appear
  in embarc's curated list (89%).
- **medium** — one weakened or contradicted signal: a weak-class name with a registration and
  nothing else, or a 6770 filer that registered only AFTER shedding a blank-check name.
- **low** — a blank-check name only in history with the registration filed after the rename
  (the Form 10 shell pattern), OR 6770 with no registration on file at all.

A latest `s1_classification.is_spac = false` (by filing date) also caps identify at `low`, and
`sec sync spacs` process skips that CIK even if an older candidate row is still medium. That is
how an operating company that only _looks_ like a blank check (Associates First Capital, Sprint
Capital) leaves the worklist without a fourth rung. A CIK that already has a `spac` row is never
dropped this way. `null` (no registration parsed yet) leaves the ladder in place.

Why the screen is worth having: `entities.sic` is the _current_ code and drifts off 6770 at the
de-SPAC, sometimes before the rename (Melar Acquisition Corp. I reads 7389 while its own S-1
header says 6770). The header is the authority, but EDGAR increasingly omits it — Viking
Acquisition Corp I's S-1 carries no `STANDARD INDUSTRIAL CLASSIFICATION` line at all.

### Name patterns

Mined from names EDGAR itself codes 6770, scored by the share of S-1-family registrants
matching each pattern that carry that code (an undercount — a de-SPAC's SIC has already moved):

| pattern             | 6770 / matched | example                      |
| ------------------- | -------------- | ---------------------------- |
| `%acquisition%`     | 1099 / 1342    | the anchor                   |
| `%partnering corp%` | 5 / 5          | Corsair Partnering Corp      |
| `%opportunit%corp%` | 15 / 17        | Elliott Opportunity II Corp. |
| `%growth corp%`     | 12 / 14        | Cartesian Growth Corp IV     |
| `%merger corp%`     | 16 / 23        | Legato Merger Corp. III      |

Rejected on the same measurement: `%capital corp%` (31/99 — Sprint Capital, BBX Capital),
`%investment corp%` (BDCs, mortgage REITs), `%holdings corp%` (19/153), `%ventures corp%`,
`%spac%` (matches "space"). Only LP/LLC legal forms are excluded, never a bare "partners": 12
of the 13 registrants named both "acquisition" and "partners" without an LP/LLC suffix are
coded 6770.

A second, weaker class (`MODERN_SPAC_NAME_PATTERNS`: `%capital corp%`, `%investment corp%`,
`%special purpose%`) makes a company a candidate and can reach `medium`, but never `high` on
its own. These are near-certain in the modern era (29/32, 37/40, 5/5 among 2019–2024
registrants) and near-worthless before it — "Capital Corp" is what SPRINT CAPITAL CORP, BBX
CAPITAL CORP and EVEREN CAPITAL CORP called themselves, and over all vintages the pattern
collapses to 33/103.

### Measured recall

Against embarc's curated list (`embarc/data/generated/spacs.json`, 1,476 SPACs, S-1 dates
2006-03 → 2025-05):

| Reference vintage | In list | Found | Recall  |
| ----------------- | ------- | ----- | ------- |
| 2021–2025         | 1,005   | 977   | 97%     |
| 2019–2020         | 379     | 340   | 90%     |
| 2015–2018         | 78      | 62    | 79%     |
| overall           | 1,476   | 1,387 | **94%** |

| Status                              | In list | Found | Recall   |
| ----------------------------------- | ------- | ----- | -------- |
| Withdrawn (registered, never IPO'd) | 207     | 207   | **100%** |
| Failed (IPO'd, no combination)      | 492     | 485   | 99%      |
| In flight (S1 / Unit / DA / IPO)    | 211     | 207   | 98%      |
| Completed (de-SPAC'd)               | 567     | 489   | 86%      |

**A SPAC that withdrew or liquidated is still a SPAC** — the attempt is the fact worth
recording, and it is what sponsor-level grading is built on. Those are exactly the ones the
screen never loses. Only a _completed_ de-SPAC erases its own evidence by renaming and
recoding, and 78 of the 89 total misses are that case (CENAQ Energy, CC Neuberger Principal
Holdings, Landcadia Holdings III, dMY Technology Group III, GigCapital3, Social Capital
Hedosophia — names sharing no token with any other). No name rule reaches them; the as-filed
header SIC in the forms pipeline is what closes that gap.

In the other direction the screen finds 751 high-confidence SPACs registered from 2006 on that
the curated list does not have — before its coverage starts, after it ends, and at the recent
edge where it thins out.

Known false positives: transaction merger subsidiaries ("DEAC NV Merger Corp", "AECOM MERGER
CORP") and operating companies that happen to fit ("Canopy Growth Corp") — roughly 6 of the 65
matches the non-"acquisition" patterns add.

### `sec spac download`

Fills the on-disk `accessiondocs` cache for candidates **without** running extractors. Default
confidence is high+medium. `registration` downloads the S-1/F-1/DRS family; `8k` every
`8-K`/`8-K/A`; `everything` every filing for those CIKs. Already-cached files are skipped. Run
this before `sec sync spacs` / `sec spac process` so the forms sweep is a cache hit.

The fetch streams rather than materializes — see `docs/fetch-and-storage.md` §3. Since success
is the absence of an error rather than a returned value, a fetch that reports success but
leaves no cache file is **counted as a failure**: the streaming path holds nothing else, and
reporting it beats leaving the cache empty for the later forms sweep to miss on.

Failures never abort the sweep: each is counted with a short reason (404 vs 403 vs an
exhausted-retry 429 stay distinguishable), warned per filing, and tallied by reason at the end.
Skips are reported three ways — already-cached, no filename on the filing, and a filer-authored
name that could not be made path-safe — because only the first is a healthy steady state.

> ⚠️ **`--force` deletes the cache entry and then re-fetches.** The delete is the point: the
> fetch task's own file cache keys off that exact path and is consulted before the fetch runs,
> so without it a "re-fetch" is served from the very file being replaced. Deleting is also the
> only variant that keeps `SecFetchFileOutputCache`'s tmp+rename as the single writer.
>
> But the delete **precedes** the fetch, so a `--force` run whose fetch then fails leaves NO
> cached document — a merely-stale entry ends up empty, and a mistyped broad run evicts a large
> cache before re-fetching it at the SEC rate limit. This is **not** the behavior of
> `sec bootstrap download-docs --force`, which streams from a tarball and overwrites once the
> bytes are in hand. Scope a `--force` run before using it; losses show up in the `failed`
> count and a re-run refills them.

---

## 10. Editorial data (embarc parity)

`spac.url_sponsor`, `spac.url_spac`, the freeform `spac.details` JSON map, and
`family_description` blurbs have **no reliable SEC-filing source** — they are hand-curated.
Spac-row writes go through `SpacReportWriter.recordEditorial`, which rebuilds at the row's own
`as_of` anchor: values overwrite on re-import but the anchor never advances, and no automated
`record*` writer carries these fields, so filing replays can never null them. Family
descriptions are keyed by `(family_kind, normalized_name)` — outside the canonical tier — so
resolver re-mints and `dropPrevious` never wipe them.

```bash
sec editorial set <cik> --url-sponsor <url> [--url-spac <url>] [--details '<json>'] [--create-missing]
sec editorial set-family-description "Chardan" --kind underwriter-family "<text>"
sec editorial import data/editorial/spac-editorial.csv [--create-missing] [--dry-run]
sec editorial import data/editorial/family-descriptions.csv
```

The committed CSVs under `data/editorial/` were extracted from the embarc repo's legacy JSON by
a one-off script (sec.gov links excluded as merge pollution — real sponsor sites come from the
legacy `url_sponsors` array). Import skips CIKs with no spac row unless `--create-missing` (a
spac row marks the CIK a known SPAC, gating 8-K/proxy processing). `family-descriptions.csv` is
a header-only template — embarc has no family blurb data.

embarc's curated SPAC **unit structure** is deliberately **not** imported — the S-1/424
offering-terms extraction derives those figures from filings. It is committed instead as an
extraction truth dataset for the eval harness; see `docs/eval.md`.

---

## 11. Other SPAC / issuer queries

```bash
sec underwriter by-family "Goldman Sachs"    # IPOs underwritten by a family (alias-aware)
sec issuer tickers <cik>                     # point-in-time ticker series
sec issuer deal <cik> [--format json]        # registered (S-1) vs final priced terms, with deltas
```

Offering terms, underwriters and use of proceeds are extracted from the S-1/F-1 and re-extracted
from the priced 424 — see `docs/extraction.md` §3. Underwriters land on the company tier and
roll up to the `underwriter-family` resolver tier; `issuer_ticker` is a point-in-time exact
series, distinct from the mutable submissions-API `entity_tickers`.

---

## 12. Downstream: accredited portals (moved to embarc-data)

Accredited-investor portal curation (`accredited_portal` / `accredited_portal_signal`) and
Form D → portal attribution (`form_d_portal_attribution`) are curated/derived values computed
**on top of** SEC data, so they live in the private **embarc-data** superset. `processFormD` no
longer attributes (ingestion only produces observations), and standalone `sec db setup` no
longer creates those three tables. See embarc-data's docs for the `accredited-portal`
commands.

sec exposes the general downstream seams embarc-data builds on — `registerResolverExtension`
(`docs/identity.md`), `registerDatabaseExtension` and `registerDbStatsTables`
(`docs/fetch-and-storage.md`) — plus the observation/versioning/normalization internals, all
re-exported from the package barrel (`src/index.ts`).
