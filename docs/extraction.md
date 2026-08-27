# AI extraction

Reference for the extraction pipeline: models, dead letters, per-extractor sections, and
document segmentation.

---

## 1. Models

All extractors share a general default (`SecModelDefault` in `src/config/Constants.ts`).
`SEC_MODEL_DEFAULT` changes every extractor at once; a per-extractor var overrides one:

| Extractor                   | Var                         | Confidence floor                       |
| --------------------------- | --------------------------- | -------------------------------------- |
| S-1 / 424 offering sections | `SEC_S1_MODEL`              | `SEC_S1_CONFIDENCE_FLOOR`              |
| S-1 risk factors            | `SEC_S1_RISK_FACTORS_MODEL` | `SEC_S1_RISK_FACTORS_CONFIDENCE_FLOOR` |
| S-1 SPAC content classifier | `SEC_S1_CLASSIFIER_MODEL`   | `SEC_S1_CLASSIFIER_CONFIDENCE_FLOOR`   |
| Merger proxies              | `SEC_MERGER_PROXY_MODEL`    | `SEC_MERGER_PROXY_CONFIDENCE_FLOOR`    |
| Redemption 8-Ks             | `SEC_REDEMPTION_MODEL`      | `SEC_REDEMPTION_CONFIDENCE_FLOOR`      |
| LOI 8-Ks                    | `SEC_LOI_MODEL`             | `SEC_LOI_CONFIDENCE_FLOOR`             |

Every floor falls back to `SEC_S1_CONFIDENCE_FLOOR` when unset.

Each variable is a **CSV list**; position is attempt order. The reserved id
`deterministic` is that extractor's sync table/prose walk — `deterministic,claude-haiku-4-5`
walks first, and omitting it means the walk does not run. The built-in default stays a cloud
id, so restoring walk-then-model means setting e.g.
`SEC_S1_MODEL=deterministic,<current>` explicitly.

### Model id shapes

`registerSecModels` (`src/config/registerModels.ts`) registers the default plus any set
overrides plus the local HFT default. `secModelRecord` dispatches on id shape; the full list
is `KNOWN_MODEL_ID_SHAPES` in that file — the string the unknown-id error prints, so it
cannot drift from the dispatch.

| id shape                                         | provider                |
| ------------------------------------------------ | ----------------------- |
| `llama:…` / `node-llama:…` / `gguf:…`            | `LOCAL_LLAMACPP`        |
| `onnx:org/name`                                  | `HF_TRANSFORMERS_ONNX`  |
| `hfi:[provider:]org/name`                        | `HF_INFERENCE`          |
| `open-router:[provider:]vendor/model`            | `OPENROUTER`            |
| `claude-*`                                       | `ANTHROPIC`             |
| `gpt-*` / `chatgpt-*` / `o1-*` / `o3-*` / `o4-*` | `OPENAI`                |
| `gemini-*`                                       | `GOOGLE_GEMINI`         |
| `grok-*`                                         | `XAI`                   |
| `deepseek-*`                                     | `DEEPSEEK`              |
| `deterministic`                                  | sync walk (no provider) |

Every record explicitly declares the `json-mode` capability `StructuredGenerationTask` gates
on — the installed provider's capability inference does not recognize newer ids.

**A bare `org/name` id routes nowhere.** Every local/gateway shape needs its prefix, so a
HuggingFace ONNX repo is `onnx:onnx-community/…` and a `deepseek-ai/…` repo is
`onnx:deepseek-ai/…`. The unknown-id error says so for any id containing a `/`.

A `gguf:` id may also be a **remote URI** — a node-llama-cpp HuggingFace URI
(`gguf:hf:org/repo:Q4_K_M`) or an `https://` URL — which `secModelRecord` turns into a
`model_url` plus a local `model_path` / `models_dir` under the GGUF models dir. A plain
`gguf:` path stays a load-directly local file.

### Providers

`registerSecProviders` (`src/config/registerProviders.ts`) registers five inline cloud
providers — Anthropic, OpenAI, Google Gemini, xAI, DeepSeek, each keyed by
`<VENDOR>_API_KEY` — plus the worker-backed local providers `HF_TRANSFORMERS_ONNX`
(`hftWorker.ts`) and `LOCAL_LLAMACPP` (`llamaCppWorker.ts`). Each registers defensively: a
load failure or missing key warns and is skipped. Absent a working provider/key, each AI
section dead-letters instead of aborting the filing.

**OpenAI reasoning families couple two knobs.** `gpt-5.6-luna` answers `temperature` alone
with `400 Unsupported parameter` but accepts `{reasoning: {effort: "none"}, temperature: 0}`.
`finalizeResponsesRequest` therefore turns reasoning off for any request pinning a
temperature, so no caller has to know. Override with `SEC_OPENAI_REASONING_EFFORT`
(`low`/`medium`/`high`); the enum is per-model, so an unsupported value fails loudly.

> ⚠️ **DeepSeek's `json-mode` is not schema-enforced.** The API supports only
> `response_format: {type: "json_object"}`, so the provider passes the schema in the _prompt_
> and the model may ignore it — weaker than Anthropic/OpenAI/Gemini (server-side) or
> llama.cpp (grammar-constrained). `StructuredGenerationTask` re-validates, so a bad shape
> dead-letters rather than corrupting data, but expect a higher schema-failure rate than the
> cost table suggests.

> **HFT chat-template workaround.** transformers.js 4.2.0 bundles jinja **0.5.6**, which
> predates the `{% generation %}` strip, so a newer template carrying `{%- generation -%}`
> throws `Unknown statement type: generation`. `hftWorker.ts` calls
> `patchHftChatTemplateGenerationTags` (`src/config/patchHftChatTemplate.ts`) to strip those
> inert training-only markers. Remove once the provider bundles a newer jinja.

### Download-before-use harness

Local weights must be on disk before generation, and providers differ on when that happens:
HuggingFace ONNX auto-fetches on first generation; node-llama-cpp loads `model_path` directly
and never fetches; cloud models have nothing to download but must still exist on the provider.
`EnsureModelDownloadedTask` (`src/task/model/EnsureModelDownloadedTask.ts`) is the single
seam. It takes a **model id**, resolves the provider via `secModelRecord`, and:

- runs `ModelDownloadTask` for local providers (memoized per model id, so a per-section sweep
  pays the download once), skipping a bare-path GGUF; and
- runs `ModelInfoTask` for cloud providers so a typo'd or retired id fails before extraction
  starts — each `model.info` run-fn hits the live API, never a curated fallback list.

It runs as an **owned** subtask (`context.own`), so it inherits the running task's registry
and abort signal. **Pass the real `IExecuteContext`, not a stub** — that is what forwards the
download run-fn's `phase` events to `context.updateProgress`, so a multi-GB fetch shows a
live percentage instead of a silent hang, and what makes Ctrl-C abort it.

`prefetchModel(modelId, context)` is the best-effort wrapper CLI-task boundaries call (own +
run, swallowing failures): the AI form processors prefetch once after resolving their model,
and the eval loops prefetch before their timed sections so download time is not charged to a
model's latency. `runStructured` keeps an `ensureModelDownloaded` call as a per-section
safety net for a sub-extractor's distinct model, but the progress-bearing fetch lives at the
task boundary.

---

## 2. Dead letters

The vocabulary is `DEAD_LETTER_REASON_CODES` in
`src/storage/dead-letter/ExtractionDeadLetterSchema.ts`, which carries each code's own
rationale as a comment:

`SECTION_NOT_FOUND`, `MODEL_INVALID_OUTPUT`, `MODEL_EMPTY`, `MODEL_RESOLUTION_ERROR`,
`LOW_CONFIDENCE_ALL`, `PRIMARY_DOC_UNRESOLVED`, `FETCH_ERROR`, `PARSE_ERROR`, `STORE_ERROR`,
`OVERSIZED_INPUT`, `UNVERIFIED_SOURCE_SPAN`, `SOURCE_SPAN_TOO_LONG`, `MIXED_CAPTION_SHAPE`,
`NONCE_MISMATCH`, `RATE_LIMITED`, `CONVERTER_NO_STRUCTURE`.

The stored column is a plain string, so `DeadLetterInput.reason_code` is typed to that union
— a code written but never declared used to persist silently (which is how
`UNVERIFIED_SOURCE_SPAN` and `SOURCE_SPAN_TOO_LONG` were both written for some time without
appearing in the list an operator reads). Adding one is now a compile error until declared.

```bash
sec extractor dead-letters <id>             # list pending entries
sec extractor dead-letters <id> --eligible  # count entries eligible for retry
sec extractor retry-dead-letters <id>       # re-run filings eligible under the current version
```

`sec version promote extractor <id>` announces how many entries became eligible.

### Retry semantics

Most codes are **version-gated**: fix the extractor, bump the version, then retry. Three
exceptions:

| Code                     | Retryable under the same version?                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `MODEL_RESOLUTION_ERROR` | Yes, unbounded — the model/provider was not registered                                     |
| `RATE_LIMITED`           | Yes, unbounded — the provider throttled and the section spent its whole wait-out budget    |
| `MIXED_CAPTION_SHAPE`    | Yes, **bounded** — `NONDETERMINISTIC_REASON_CODES` / `NONDETERMINISTIC_RETRY_ATTEMPTS` (3) |

The first two are `MODEL_ERROR_REASON_CODES`. They are deliberately **not** the same code
even though their retry semantics match: `MODEL_RESOLUTION_ERROR` means add a key or register
a provider; `RATE_LIMITED` means wait. Merging them makes the worklist counts unreadable
during exactly the outage an operator would be triaging.

`MIXED_CAPTION_SHAPE` describes one generation's response rather than an extractor defect, so
a version bump is the wrong ceremony — but unlike a provider outage a genuinely ambiguous
section never clears on its own, and an unbounded retry would leave an entry no operator can
resolve while re-paying the AI cost of the largest section in the filing on every sweep.
After three recorded attempts it falls back to the version gate.

**`attempts` counts consecutive failures of the current `(reason_code,
failed_extractor_version)` pair** and restarts at 1 when either changes (and is zeroed by
`markResolved`). The row is keyed by section, so a lifetime counter would be shared across
every code the section ever hit — a section that failed `UNVERIFIED_SOURCE_SPAN` three times
under an older version would arrive at its first-ever `MIXED_CAPTION_SHAPE` already over
budget.

### `MODEL_INVALID_OUTPUT` is never an expected negative

It is the section runner's catch-all for any throw it could not classify — a provider 5xx, a
schema rejection, a failure inside `persist` — so it says nothing about what the filing
disclosed. `EXPECTED_NEGATIVE_REASON_CODES` is therefore `MODEL_EMPTY` **only**, scoped to
the `loi` / `redemption` detectors: those extractors record a successful run row regardless,
so treating a catch-all failure as a confident negative left no extraction row, no pending
entry, and nothing for the forms sweep or backfill anti-join to re-select.

### Filing-level dead letters

`ProcessAccessionDocFormTask` adds an entry with `section_name = ""` (rendered `(filing)`)
for each of four stages, recording the failure, marking the run failed, and returning
`{ success: false }` rather than throwing:

| Stage                   | Reason code              |
| ----------------------- | ------------------------ |
| No primary document     | `PRIMARY_DOC_UNRESOLVED` |
| Body fetch threw        | `FETCH_ERROR`            |
| Parse threw / was empty | `PARSE_ERROR`            |
| Storage handler threw   | `STORE_ERROR`            |

This is what makes the structured-XML extractors (Form D, the Form C family, 1-A/1-K/1-Z,
ownership 3/4/5, 144, CFPORTAL) recoverable: they have no sections, so the filing-level key
is their whole story. `STORE_ERROR` is version-gated like `PARSE_ERROR` — the fix lives in the
extractor's storage code. A transient backend blip does not need the worklist at all: the
failed run row makes the ordinary forms sweep re-select the filing, and a clean run resolves
the entry automatically. Ctrl-C is re-thrown from the store stage rather than dead-lettered.

---

## 3. S-1 / F-1 / DRS extraction

S-1 prospectuses are narrative HTML, so the extractor parses the SGML header
deterministically and uses AI structured generation for the rest.

```bash
sec fetch form <cik> S-1
sec fetch form <cik> 424B4      # priced prospectus
```

### Sections

| Section                | Table                                 | Notes                                       |
| ---------------------- | ------------------------------------- | ------------------------------------------- |
| Management             | `person_observations` + `person_role` | Roster-complete: closes unasserted tenures  |
| Beneficial ownership   | ownership tier                        | `owner_kind` discriminates person vs entity |
| Related party          | related-party tier                    | No golden fixture yet                       |
| Executive compensation | `executive_compensation`              | See below                                   |
| Offering terms         | `offering_terms` / `spac_unit_terms`  | Plus `issuer_ticker`                        |
| Underwriters           | `underwriter_link` + family tier      |                                             |
| Use of proceeds        | `use_of_proceeds`                     |                                             |
| Sponsor promote        | `spac_promote_terms`                  | SPAC only                                   |
| Lock-ups               | `spac_lockup_terms`                   | One row per restricted class                |
| Risk factors           | `risk_factor`                         | Chunked; parked in production (see below)   |
| SPAC classification    | `s1_classification` + `spac`          | See `docs/spac.md`                          |

The offering-sections logic and the per-section dead-letter ceremony are shared with the 424
processor (`s1/offeringSections.ts`, `s1/sectionRunner.ts`).

### iXBRL / XBRL facts

Modern S-1s embed inline XBRL (`ix:nonFraction` / `ix:nonNumeric` against `dei`, `us-gaap`,
`spac`); older submissions may carry a standalone instance (`EX-101.INS`); and since the
filing-fee modernization the fee table is a separate `EX-FILING FEES` exhibit tagged against
`ffd` (carrying `ffd:MaxAggtOfferingPric` / `ffd:TtlOfferingAmt` — the registered offering
size as a deterministic fact). `src/sec/xbrl/` parses these into a shared
fact/context/unit model (no taxonomy/linkbase processing), and `processFormS1` runs this
deterministic pass **before** AI extraction:

- every fact persists to `xbrl_fact` (`src/storage/xbrl/`), keyed
  `(accession_number, fact_index)` with period/dimensions and resolved unit denormalized onto
  the row; fee-exhibit facts share the accession with `source = "fee-exhibit"` and continue
  the primary document's `fact_index` sequence;
- dei cover-page facts (registrant name, incorporation state, address, phone) upgrade the
  issuer company observation (`s1/xbrlEnrichment`)
  with `source_context.attributes_source = "xbrl-dei"`;
- **XBRL failures never abort the filing** — extraction degrades to the untagged path.

`parseToBlocks` skips `display:none` subtrees so the hidden `ix:header` block does not leak
into the prose handed to section extractors. Non-numeric date facts normalize to ISO-8601 via
the ixt transforms in `ixtTransforms.ts`, handling both TR1 concatenated
(`datemonthdayyearen`) and TR3/TR4 hyphenated (`date-monthname-day-year-en`) spellings; a
registered transform that cannot parse its text keeps the trimmed raw text rather than
blanking the fact.

```bash
sec query xbrl <accession> [--concept TrustAccount] [--numeric-only] [--format json]
sec query xbrl --cik <cik> --concept AssetsHeldInTrust    # a concept's series across filings
```

### 424 prospectuses

`424A`, `424B1`–`424B5`, `424B7` (extractor id `424`) run `processForm424`. Every variant
gets the deterministic XBRL pass — pay-as-you-go 424B2s carry `ffd:NrrtvMaxAggtOfferingPric`
and `ffd:RegnFileNb`, which ties the prospectus back to its registration file number — plus
an issuer observation resolving to the same canonical company as the registration statement
(`relation: "424:issuer"`).

The **priced** forms (`424B1` / `424B4`) additionally run the AI offering sections, recording
the **final** deal under extractor id `424` alongside the S-1's registered terms (compare
`spac_unit_terms` / `offering_terms` across the two extractor ids). Fee-prepaid 424s carry no
fee exhibit and no XBRL; when the prospectus body is untagged, the fee exhibit's dei facts are
the cover-page fallback.

### Executive compensation

The Item 402 **Summary Compensation Table** lands in `executive_compensation`
(`src/storage/executive-compensation/`), one row per named executive officer **per fiscal year**, keyed `(extractor_id, accession_number,
row_index)` and cleared before re-insert. The money columns are the union of Item 402(c) and
the scaled Item 402(n) most S-1 registrants report under; every one is nullable, so both
regimes map onto the same row without a discriminator.

The officer is linked by `observation_id` — minted **once per officer**, so an officer shown
for two fiscal years is two rows against one mention, which is why the row key and the FK are
separate columns. The claim carries **no `role_scope`**: the compensation table names only
the NEOs, a strict subset of the management roster, so it records observation titles but
mints no `person_role` tenure and can never participate in the `s1:management` roster
closure. `principal_position` stays on the row because it is the position as stated for that
fiscal year.

Extraction is an AI pass, not a table parse, even though the column set is prescribed by
regulation: in real EDGAR markup the caption row is `<td>` rather than `<th>`, captions are
colspan-stretched across spacer columns, and the layout differs by filer agent. The stable
part is the caption vocabulary, which is what `hasSummaryCompensationTable`
(`s1/compensationHeuristic.ts`) keys on — in real markup `TableExtractor` reports zero
header rows, so the grid itself is no help.

That gate runs first and keeps the section cheap. A blank-check company's compensation
section is one sentence stating that nobody has been paid, and most registration statements
have no such section at all (nothing in `byName` under `Executive Compensation`). **Neither is a failure**, so neither costs an AI call and both
`markResolved` — which also clears an entry a previous version left. Recording the no-section
case would put an entry on the worklist for the majority of all S-1s, permanently (only a
version bump clears one), burying every triageable entry.

The stub-column **position line** is folded onto the officer named above it (that row commonly
carries a different fiscal year's figures), but only when it carries something: a position
row with no fiscal year and no money column is just the label, and folding it unconditionally
emitted a second all-null row per officer.

Not yet wired into the priced-424 path, which repeats the same table.

### Lock-ups

One `spac_lockup_terms` row per restricted class, keyed
`(extractor_id, accession_number, lockup_index)` — several per filing, because a filing states
several: the underwriters' lock-up on the whole float, the sponsor's on its founder shares,
often a longer one on the private-placement warrants. They have different durations, anchors
and price tests; folding them into one row would state a release date that applies to none.

**The row is what the filing SAYS, never a date.** A duration (`duration_days`) is meaningless
without its `anchor_event` — a founder lock-up runs from the CLOSING of the combination, an
underwriter lock-up from the PRICING — and the price test is a condition on a series this
extractor does not have: `price_trigger` at or above on `trigger_days_at_or_above` sessions
within any `trigger_window_days`, no earlier than `trigger_start_delay_days` after the anchor.
Evaluating that against real prices is a downstream step, which is what keeps this extractor
from emitting a computed-looking release date it did not compute.

Two things the prompt must say, and does:

- **A duration and a price trigger are ALTERNATIVES on one lock-up, not two lock-ups.** "One
  year, or earlier if the shares close at or above $12.00 for 20 trading days within any
  30-trading-day period" is one row carrying both.
- **Do not assume a customary term the filing omits.** The customary founder lock-up is
  standard enough that a model will supply it for a prospectus stating only an underwriter
  lock-up; the `lockup-underwriter-only-no-price-test` fixture measures exactly that.

`holder_class` is constrained by the schema rather than the prompt, and `persist` filters
against the same vocabulary.

The section text is the Item 12 `Shares Eligible for Future Sale` block, falling back to
`Underwriting`. Both are needed, on measurement: of the 42 committed S-1 fixtures, 14 carry
the Item 12 heading and 32 disclose a lock-up somewhere. Unlike `sponsor-promote` the section
is never skipped for a non-SPAC filing — every registrant locks somebody up.

### Risk factors

One `risk_factor` row per disclosed risk, keyed
`(extractor_id, accession_number, risk_index)` in document order: the filer's **caption**
verbatim (the bolded lead-in sentence) plus the **category heading** it sits under, as
printed. The multi-paragraph body is deliberately not stored — the caption is the enumerable
unit and the filing stays the body of record — and neither field is mapped to a taxonomy, so
any classification can be derived on top later.

`verifyRow` checks the **headline as well as** the `source_span`: a paraphrased or invented
caption is worthless even when its span verifies, so it is dropped (and, when every row is,
dead-lettered `UNVERIFIED_SOURCE_SPAN`).

**Chunking.** Risk factors is by far the largest section in an S-1 — 3k to 246k chars across
the committed fixtures, against 40–57k for the sections that already dominate wall-clock — and
the only one enumerating dozens of rows, so one response cannot hold ~90 captions without
truncating the JSON. `chunkRiskFactorText` (`s1/riskFactorChunks.ts`) splits on paragraph
boundaries into 40k-char chunks and prefixes every chunk after the first with the last
category heading seen before it (a verbatim line, so spans still verify), reporting that line
back as `RiskFactorChunk.carriedHeading`. `extractRiskFactors` runs one call per chunk,
concatenating in document order and de-duplicating on the caption. **A chunk that fails fails
the whole section** — persisting the captions that arrived first would record a silently
partial list as the filing's complete disclosure. A section over `MAX_RISK_FACTORS_CHARS` (400k chars) is a segmentation
failure, not a real disclosure, and dead-letters `OVERSIZED_INPUT` — mirroring the
redemption/LOI 8-K input caps.

**The carried-heading echo problem.** A ~7-chunk section hands the model ~6 headings and
invites it to echo them back as rows. A row whose caption is exactly the carried line is
**remembered as a candidate echo** but not yet dropped — and the verdict is taken over the
response's shape **as a whole**, after every chunk has answered, computed over the rows
**minus** the candidate echoes:

- **all heading-like** — the section IS a summary list, its "headings" are its captions, so
  the echoes are kept;
- **none heading-like** — an ordinary sentence-caption list, so the echo is the line this code
  prepended and is dropped;
- **mixed** — unanswerable, and dead-letters `MIXED_CAPTION_SHAPE` (via
  `MixedRiskCaptionShapeError`) rather than persisting a subset.

Dropping the echo where it is found loses real captions, because de-duplication runs first:
the echo branch is reachable only for a caption no chunk emitted on its own. On a filing whose
section IS an Item 105(b) summary list, every bullet is heading-shaped and the carried line is
itself one of the filer's bullets, so the drop would delete a disclosed risk and mark the
section resolved.

**"Heading-like" is `isRiskCategoryHeading`, and it is TWO conditions**: the line does not end
in sentence punctuation **and** it mentions risk (`\brisks?\b`). Both halves are load-bearing
— do not relax it to a punctuation-only test. Measured over the committed golden labels: 52
captions carry no terminal punctuation and **zero** of them contain the word "risk"; all 52
sit in 14 filings that also print ordinary punctuated captions. Under a punctuation-only
predicate all 14 would throw `MIXED_CAPTION_SHAPE`, permanently version-gating the **1,411**
hand-verified captions those filings carry.

A ratio-gated variant (drop heading-shaped rows while they are a small minority) was tried and
removed: it deleted four bare bullets out of twenty from a section that then resolved clean.
The price of the strict rule is that one stray heading fails the whole section; it fails
visibly, with every caption recoverable by re-running.

Because a mixed shape is a property of one generation, `sectionRunner` re-asks up to
`MIXED_SHAPE_REASK_ATTEMPTS` (2) times before recording it — deliberately smaller than the
`VERIFICATION_ATTEMPTS` (3) a failed span verification gets. A malformed citation varies run
to run; a mixed shape re-asks a byte-identical prompt under greedy decoding, where only
provider-side batching can change the answer, and each ask re-enumerates the largest section
in the filing. Worst case for a 7-chunk section is 42 calls rather than 63.

The remaining dropped echo is **attributable**: `extractRiskFactors` reports the dropped
headlines verbatim, and the S-1 processor records them as a sibling
`risk-factors-echo-dropped` dead letter carrying the accession and removed text — reconciled
on a run that drops nothing. A `console.warn` naming a count is what made the earlier variant
unreviewable; this branch still deletes rows a model returned and still lets the section
resolve as complete, so it must leave a record.

**Production extraction is parked** (`EXTRACT_S1_RISK_FACTORS` in `Form_S_1.storage.ts`).
`sec spac process` / `sec sync spacs` skip the AI call, leave previously extracted rows in
place, and do not dead-letter the section. Flip the constant (or pass
`extractRiskFactors: true` in tests) to re-enable; already-processed S-1s then need
`sec extractor backfill S-1 --force`. The `risk-factors` eval entry is likewise flagged
`disabled` — see `docs/eval.md`.

Scoped to the S-1/F-1/DRS pipeline: the 424 processor shares the segmenter but does not
re-extract risk factors (a priced prospectus restates the registration statement's risks), and
no CLI query renders the table yet.

---

## 4. Segmentation

`DocumentTreeSegmenter` runs two passes. The first keeps, per target, the occurrence with the
most body text; the second truncates each chosen section where it has **swallowed another
chosen section's body**. A converter that mis-levels a heading — `RISK FACTORS` in all caps at
the top level, every following sentence-case heading nested beneath it — makes that section's
subtree the rest of the prospectus: committed fixtures rendered "prospectus summaries" of 966k
and 1,008k characters, and one filing's risk factors reached 586k and was never extracted.

The stop condition is narrow in two load-bearing ways. The nested node must be another
target's **chosen** body (a summary contains a management paragraph, but that loses to the
filing's real section and so stops nothing), and the containment must not be one prospectuses
really have (`LEGITIMATE_CONTAINMENTS`: summary ⊃ offering, summary ⊃ sponsor, management ⊃
Item 402 compensation). A summary's own Item 105(b) risk list is deliberately absent from that
list — the segmenter accepts it as a Risk Factors heading variant, so allowing it let three
fixtures keep summaries carrying the entire risk section verbatim.

### Bolded rather than headed sections

Targets a filer bolds rather than heads are recovered from inside whichever resolved section
carries them, by `findNestedSection`, which scans the container's rendered lines with the same
heading patterns. Item 402 compensation sits inside `Management` that way, and so does the
ownership table in `TCG Growth Opportunities Corp.` It fires only when the tree walk found no
section for the target, and the **tightest** enclosing body is tried first.

The rule is general with **one container excluded**: `RESTATING_CONTAINERS` — today just
`Prospectus Summary`. A summary's job is to restate the whole prospectus by name, so every
bolded label in it opens a slice for a section the filing may not disclose at all. That is the
entire measured cost of generalizing: 6 wrong sections across the 42 committed fixtures, **all
6** from a summary. Excluding it leaves **zero** additions on the corpus, so the
generalization costs nothing and covers pairs nobody enumerated — on a real filing outside the
corpus (`Harvard Ave Acquistion Corp`, CIK 2042460) it recovers a genuine 20k `The Sponsor`
block from inside `Management`.

A real block inside a restating container is still reachable by naming it in
`NESTED_SECTION_FALLBACKS`. There is exactly one: the offering table inside the summary, which
`LEGITIMATE_CONTAINMENTS` already expects and which `Mammon Omicron Acquisition Corp` bolds
rather than heads, hiding 90k characters of unit terms. Declared pairs are consulted **after**
the general containers — a real body section donating a target is the better claim.

**A slice-size guard was measured as the alternative and does not separate them.** Five of the
six summary slices run 68–96% of their container, but the trusted compensation-inside-
`Management` recovery runs 7–81% across 18 fixtures, 14 of them above 68% — the bands sit on
top of each other, and the sixth summary slice is 14%, below all of them. Which section is
donating separates the good recoveries from the bad; how much of it does not.

Guessing the remaining pairs from **document order** does not work either: the container is the
nearest _resolved_ predecessor, not the immediate one. Ranking each section's observed
predecessor predicts the compensation and offering pairs correctly and gets the ownership one
wrong — it names `Executive Compensation`, which is true of a headed filing and not of `TCG`,
where that section is itself unheaded so the container moves up to `Management`.

### Cover-page front matter

A registration statement's cover page is typeset as a stack of short, bold, centered,
all-caps lines — the shape a heading has — so `HeadingDetector` reads every line of it as
one. Each then opens a section holding a single line: `UNITED STATES`, `FORM S-1`,
`Vista, California 92081`, `Krishna Vanka`. Across the committed S-1 and 424 corpus that is
507 headings, ~12 per filing and 14.2% of all sections, carrying 2.5% of the text.

`demoteCoverPageHeadings` (`src/sec/html/coverPage.ts`) turns every heading before the table
of contents back into prose, so the front matter lands in the document's preamble as one
block. Demoted rather than dropped: the cover page carries the registrant's name and
address, the agent for service and the preliminary-prospectus legend, and removing it would
lose text the coverage measure counts.

It runs **after** de-pagination, because a typeset prospectus repeats "Table of Contents" as
a page back-link on cover pages too — on the raw block list the first match can be furniture
rather than the index. The search is bounded to the first 200 blocks (the corpus's deepest
table of contents sits at block 54, the median at 32), and a heading matching
`isTargetSectionLine` is never demoted — the same guard `joinSplitHeadings` uses, so a form
whose front matter opens on a real section keeps the heading it hangs on. No cover-page
heading in the corpus matches it.

### Parenthesised captions

A heading that is wholly one parenthetical labels the line above it rather than naming what
follows, but it is short, bold and centered, so `HeadingDetector` reads it as a heading and it
opens a section holding everything to the next one.

`demoteParentheticalHeadings` (`src/sec/html/parentheticalHeadings.ts`) turns those back into
prose. The whole-line condition is what separates a caption from a title carrying an aside:
`Plan of Distribution (Conflict of Interest)` closes its parenthesis mid-line and survives, and
so does `(a) Financial Statements (b) Exhibits`, which is two groups rather than one wrapper.

What it recovers is content, not tidiness. The worst cases measured are 21,556 and 19,669
characters of financial statements filed under `(in thousands, except share and per share
data)`, and three prospectus supplements filing 7.5k–7.7k of Form 8-K disclosure apiece under
`(Former name or former address, if changed since last report)`. Demoting is also the right
merge: the text folds into the heading above, which is the caption's own subject, so the
financials land under `CONSOLIDATED BALANCE SHEETS`.

Measured share: 37 of 3,286 sections across the committed S-1 corpus (1.1%) and 21 of 381
across 55 424B3 supplements pulled from EDGAR (5.5%). It carries no target-section guard,
unlike the heading join — all 54 segmenter patterns are whole-line anchored, so a
parenthesised line cannot match one and a guard would never fire.

### Exchange Act item headings

An 8-K is organised by numbered items, and its filers punctuate them as sentences —
`Item 2.02. Results of Operations and Financial Condition.` — which `HeadingDetector`'s two
prose rules both reject. Across the 15 committed 8-K fixtures **not one** item line was a
heading, so an item's disclosure was filed under whichever cover-page line happened to
precede it. In `Flux Power Holdings` (424B3 `0001493152-26-035455`, which reproduces an 8-K
inline) that meant 4,287 characters of a Nasdaq delisting notice stored under
`Registrant's telephone number, including area code: 877-505-3589`.

`isHeadingCandidate` therefore accepts a line beginning `Item N.NN` ahead of the prose
rules. Two-part numbering is what scopes it: Part II of a registration statement numbers
its items `Item 13.` and a 10-K `Item 1A.`, neither of which matches, so the rule reaches
8-K vocabulary and nothing else — measured, it moves 0 of 3,753 headings across the
committed S-1 corpus and adds 15 across the 8-K fixtures.

Emphasis is **not** required, unlike every other candidate: 7 of those 15 item headings
carry no emphasis trait at all. The scope is the guard instead. `isHeadingCandidate` runs on
one leaf element's whole text, before prose coalescing, so a mid-sentence cross-reference
(`as described below in Item 5.07 to this Current Report`) is never at the start of its own
element and cannot open a section.

Item headings **typeset as tables** are recovered separately, by
`itemHeadingFromTable` (`src/sec/html/itemHeadingTables.ts`). 8 of the 15 fixtures write the
item as a two-cell row — the number pinned to a tab stop, the title beside it — which is a
layout box rather than data and which the candidate test never sees, since it runs on leaf
text elements.

What identifies one is the title, not the shape. Form 8-K prescribes the wording of every
item, so `Form_8_K_ITEMS` is a closed vocabulary and an **exact** match against it is a fact
rather than a heuristic: 35 of the 37 blocks leading with `Item N.NN` across the 8-K, 424B3
and S-1 corpora carry precisely the prescribed title. The two that do not are both a table of
contents, which prints the same text and then runs on into a page number and the next item —
so ending the match where the regulation ends the title rejects an index by construction. A
prefix test would not: all 37 pass that.

Shape was measured as the alternative and is much worse. "One non-empty row, one or two
cells" catches 15 of the 17 item-shaped tables, but sweeps up **8,258 of the 12,092 tables**
in the S-1 corpus, because two-column layout is how a prospectus is typeset generally. The
exact-title rule touches nothing outside an 8-K.

This runs at the end of `parseToBlocks`, **before** heading levels are assigned, and that
placement is load-bearing: a heading minted after that pass keeps `level: 1` and outranks
every real section heading. It is also why this does not live with the de-paginator's
single-cell unwrap, which runs later and produces paragraphs.

Together with the prose rule above, every one of the 15 committed 8-K fixtures now carries
its items as headings — 30 in total, against none before either change.

### Line-scan fallback

When the tree walk resolves **fewer than two** targets on a document rendering at least 50k
characters, the rendered text is scanned with the same heading patterns and each hit sliced to
the next hit of a _different_ target (a typeset prospectus repeats its section name as a page
header, which is furniture rather than a boundary). Bridgetown Holdings' 3.2 MB prospectus is
typeset inside 295 tables, so the converter emits 4 heading nodes and the filing extracted
**nothing**; it now recovers all ten target sections.

Both thresholds are deliberately tight — a line scan has no structural evidence and cannot
tell a table-of-contents entry from the heading it points at, and "the converter produced no
structure" is only a claim you can make about a document big enough to have some.

The filing is still recorded, as `CONVERTER_NO_STRUCTURE` under section name `converter`. That
is deliberately NOT the filing-level `""` key — `ProcessAccessionDocFormTask` resolves that one
after a successful store, which would clear the entry on the run that recorded it — and it is
deliberately recorded even though the fallback usually recovers the filing: eight
`SECTION_NOT_FOUND` entries are indistinguishable from a legitimately
incorporation-by-reference S-1, so without it "we could not read a 3.2 MB prospectus" and
"this filing has no such section" report identically.

The segmenter's `Risk Factors` target also accepts the filer's own Item 105(b) "Summary of
Risk Factors" bullet list as a heading variant: it enumerates the same captions in compressed
form, and since the segmenter keeps the longest body per section name, a filing carrying both
extracts from the full section while one carrying only the summary degrades to it rather than
to nothing.

---

## 5. Golden fixture provenance

The **committed** corpus under `src/sec/html/mock_data/{s1,424}/` stays committed — the golden
tests are hermetic and must not depend on EDGAR being reachable (the quarterly `form.idx`
endpoint already 403s from cloud containers). What is pinned instead is its provenance:
`src/task/fixtures/goldenFixtureManifest.ts` records, per fixture, the EDGAR primary-document
filename, the SHA-256 of the bytes EDGAR serves, the capture `transform`, and the SHA-256 of
the committed file.

```bash
sec fetch golden-fixtures --verify   # re-fetch, compare, write nothing (non-zero exit on mismatch)
sec fetch golden-fixtures [--force]  # reproduce the corpus from the manifest
```

Verify reports `remote-changed` and `local-modified` separately because they demand opposite
responses: the first means re-pin the manifest, the second means a golden fixture was edited
and the tests it backs are measuring an artifact. **A digest mismatch is never written to
disk**, so a truncated response or an EDGAR error page cannot silently replace a fixture. Most
entries are `verbatim` (which for several includes the dissemination SGML wrapper EDGAR
serves); the one `strip-sgml-wrapper` entry stores the inner body, matching what
`Form_424.parse()` hands the converter. The synthetic `.txt` submissions are deliberately
absent — they exist nowhere on EDGAR. `goldenFixtures.test.ts` re-hashes with no network, so
an in-place edit fails in CI. The corpus also pins the parsers directly, via
`parseEdgarHtml.golden.test.ts` and `parseXbrl.golden.test.ts` (the latter over the
Churchill Capital Corp XII fixture, a 2026 SPAC with full `spac`-taxonomy tagging).

To refresh or grow the S-1 sample into a gitignored cache:

```bash
sec fetch s1-fixtures                 # ~10 real S-1s (>= 3 SPACs) -> mock_data/s1/.cache/
sec fetch s1-fixtures -c 20 --min-spac 5
```

---

## 6. Generalized extractor backfill

When a new extractor lands, its historical filings are recovered with the generalized sweep —
no bespoke backfill task per extractor:

```bash
sec extractor backfill <extractorId> [--force] [--dry-run]
```

`BackfillExtractorTask` resolves a per-extractor **descriptor**
(`src/task/forms/backfillDescriptors.ts`). Every form-routed extractor id
(`FORM_TO_EXTRACTOR_ID` values) is backfillable by default over all filings of its forms.
Extractors with a narrower candidate set add a descriptor entry; extractors whose recorded
success can be a gated no-op override `filterTodo`.

The default needing-work predicate is a bulk anti-join against `extractor_runs` at the active
version, exported as `defaultFilterTodo` so a descriptor that only WIDENS it does not restate
it. The `redemption` / `loi` descriptors do exactly that: their `filterTodo` is the default
UNIONED with filings whose detector section carries the `MODEL_INVALID_OUTPUT` catch-all and
produced no extraction row — those recorded a successful run while writing nothing, so the
anti-join alone never revisits them. **`MODEL_EMPTY` entries are deliberately excluded**: a
confident negative is the expected answer for most trigger 8-Ks and must not be re-paid as an
AI call on every sweep.

Each survivor re-runs `ProcessAccessionDocFormTask`, so the full form pipeline (and any
sub-extractors it gates) runs.

---

## 7. Reg A / Reg CF / funding portals

All 12 Form C submission types (including post-offering C-U / C-AR / C-TR), the full 1-A
family (including 1-A POS), and CFPORTAL portal registrations parse and store end to end:

```bash
sec fetch form <cik> C-AR
sec fetch form <cik> 1-A
sec fetch form <cik> CFPORTAL

sec query crowdfunding --portal <portal-cik>
sec query reg-a --tier Tier2 --status reporting
sec query reg-a-summary <cik>
```

Fixtures: `sec fetch fixtures C-U C-AR C-TR` extends the exempt-offering mock_data tree; the
committed ones were sourced from EDGAR daily indexes because the quarterly `form.idx` endpoint
may 403 from cloud containers. CFPORTAL fixtures live under
`src/sec/forms/portal/mock_data/cfportal/`. `isFormParsingSupported` and
`FORM_TO_EXTRACTOR_ID` are kept consistent by `src/sec/forms/form-wiring.test.ts`.

### Portal continuation (`portal_succession` / `portals.succeeded_by_cik`)

Form CFPORTAL Item 1 carries a **Successions** block — `isSucceedingBusiness` plus up to
five `acquiredHistoryDetails`, each naming the acquired portal, its SEC file number and a
free-text explanation. It is EDGAR's own record of one funding portal taking over another's
registration, and it is what makes Republic one portal rather than two: `OpenDeal Portal LLC`
(CIK 1751525) declares `007-00046`, which is `OpenDeal Inc.` (CIK 1672732).

Each `Y` filing writes one `portal_succession` row per detail, keyed
`(accession_number, detail_index)` and append-only. A filing answering `N` writes nothing —
the row exists to state a succession, and every other filing already says there was none.

Resolution is by **file number only**. `buildPortalFileNumberIndex` maps every CFPORTAL-family
filing's `file_number` to its CIK; measured over the whole funding-portal universe (137 filers
harvested from EDGAR) the mapping is 1:1 — 137 distinct numbers, none shared — which is what
makes a succession's `acquiredPortalFileNumber` a join key rather than a hint. A number two
filers share is dropped from the index instead of resolved to an arbitrary one of them.
`normalizePortalFileNumber` compares both halves as integers, since filers type `7-00065` and
`007-000012` as readily as the padded form, and refuses a value with no `-` (a bare `7` would
otherwise match every portal at once). `acquiredFundingPortal` is never used to resolve: it is
free text, and one committed filing names a predecessor ("Silicon Prairie Holdings Inc.") that
has no CIK in the index at all. An unresolved claim is kept with a null `predecessor_cik`.

`portals.succeeded_by_cik` is set on the **predecessor**, pointing forward to the filer, and
only when the resolved CIK **differs** from the filer's own. Three of the four `Y` answers in
the entire universe are self-referential — a rename EDGAR handled by keeping the CIK (Silicon
Prairie, Wunderfund) — and those produce no duplicate registration, so treating one as a
continuation would retire a filer that is still the same live portal.

That column is the only thing that says an older registration stopped. `live` means "did not
file CFPORTAL-W", and a predecessor commonly never files one: OpenDeal Inc.'s last filing is
2018-12-11 and it never withdrew, so both Republic rows read `live` and a consumer reading
`live` alone shows two live portals where there is one.

⚠️ **The claim is made once, in the filing that carries the handover** — not carried forward.
OpenDeal Portal LLC's 2018 registration answers `Y`; its 2025 amendment answers `N`. A sweep
that reads only the latest filing per portal finds nothing, which is why the fixture is the
original 2018 document.

Not yet wired: the family tier, `sec portal continuations` / `suggest-families`. The
embarc-side fold reads `succeeded_by_cik` directly.
