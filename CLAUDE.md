# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@workglow/sec` is a CLI tool built on the Workglow AI library for retrieving and storing SEC (EDGAR) filing data into a local SQLite database. It fetches CIK names, quarterly/daily indexes, company submissions, company facts, and individual filing forms (Form D, Form C, Form 1-A, etc.).

Workglow-wide design specs and implementation plans live in the PRD repository: `/workspaces/workglow/prd/docs/superpowers/specs/` and `/workspaces/workglow/prd/docs/superpowers/plans/`.

## Commands

```bash
bun install                  # Install dependencies
bun run build                # Full build (clean + JS + types)
bun run dev                  # Watch mode (JS + types concurrently)
bun test                     # Run all tests
bun test src/path/to/file.test.ts  # Run a single test file
```

The CLI entrypoint is `src/sec.ts` and uses Commander for subcommands (e.g., `./src/sec.ts company-submissions 1018724`).

Source is not shipped in the tarball. `use-source` is a workspace-local `bun link` flow that reads directly from the linked working copy on disk, so consumers using `bun link @workglow/sec` see live source without needing `src` inside `node_modules/@workglow/sec/`. Do not add `src` back to `files` in `package.json` — the `prepack-check` script guards this and CI will fail.

Local Workglow deps: from a libs checkout run `bun run link-all` (and usually `bun run use-source`), then in sec run `bun run link-workglow`. Register this package for consumers with `bun run link`. For the full libs → sec → embarc-data chain, run `bun ./dev-link.ts` from the parent `workglow/` folder (or `bun run dev-link` in libs). Re-run `link-workglow` after any `bun install`.

### Accession-document bulk cache (Feed tarballs)

The forms pipeline reads each filing's document from an on-disk cache
(`<SEC_RAW_DATA_FOLDER>/accessiondocs/<0-padded cik>/<accession-no-dashes>-<fileName>`,
see `readCachedDoc` in `ProcessAccessionDocFormTask`) before falling back to the
rate-limited per-document fetch. Fetching every filing's document individually is
millions of throttled requests; instead, `BootstrapAccessionDocsTask`
(`src/task/bootstrap/`) pre-populates that cache from EDGAR **daily Feed
tarballs** (`/Archives/edgar/Feed/YYYY/QTRn/YYYYMMDD.nc.tar.gz`) — one download
per filing day covers that whole day.

The days to fetch are exactly the distinct `filing_date` values of the ingested
`filings` (so weekends/holidays are never requested, and only submissions you
have are kept), optionally bounded by an inclusive `[from, to]` range.
`streamFeedTarball` (`feedTarball.ts`) decompresses and walks each tar in a
single streaming pass — buffering only wanted members, so peak memory is one
submission, not the multi-GB day (a single day is ~1.5 GB compressed). Each kept
member is a `.nc` **dissemination** submission: its `<DOCUMENT>…<TEXT>` bodies
are byte-identical to the public per-document files, but its header is tagged
SGML (`<SUBMISSION>`/`<CIK>`/`<CONFORMED-NAME>`/`<ASSIGNED-SIC>`/`<FILING-DATE>`),
**not** the public `.txt`'s human-readable `<SEC-HEADER>` block. Each member
writes, per form:

- the verbatim `.nc` as the full-submission `.txt` for forms parsed from the full
  submission (`REGISTRATION_PROSPECTUS_FORMS` and 8-Ks, which SPAC narrative
  passes read). `parseSecHeader` reads both header dialects (human-readable first,
  tagged `.nc` fallback), so a cached `.nc` yields the same sic/cik/name/date as a
  network `.txt`; and
- the primary document, sliced **losslessly** out of the submission SGML by exact
  `<FILENAME>` match (`extractPrimaryDocFromSubmission`; binary `<PDF>`/uuencoded
  members are skipped so the cache never holds a corrupt doc), for every other form.

Completed days are marked under `accessiondocs/.feed-done/`, so a re-run resumes;
`--force` re-downloads and overwrites. A day with no Feed archive yet (recent
dates → 404) is warned and left unmarked to retry next run. Backend-dispatched
day/filing queries (`feedFilings.ts`) mirror `createCikNameBulkWriter`
(SQLite → `getDb()`, Postgres → `getPgPool()`, else the repository).

> ⚠️ A full-history pull is a large storage commitment — roughly tens of TB
> decompressed, back-loaded onto recent years. Bound it with `--from`/`--to`.

```bash
# Standalone: download accession docs for ingested submissions (optional range)
sec bootstrap download-docs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--force]

# Or as a pipeline step (runs after ingest, before the forms step):
sec bootstrap --download-docs [--docs-from YYYY-MM-DD] [--docs-to YYYY-MM-DD]
```

### PR4 CLI additions

```bash
# Run the resolver over all observations for a given kind
sec resolve --kind person --resolver-version 1.0.0 --all
sec resolve --kind company --resolver-version 1.0.0 --all

# Alias management (person; same flags for company)
sec canonical person alias "<from-name>" "<into-name>" --reason "merged duplicate"
sec canonical person alias-remove "<name>"
sec canonical person alias-list
sec canonical person alias-list --orphans     # names whose target no longer exists

# Coverage and cleanup
sec version coverage resolver person
sec version coverage resolver company
sec version drop-previous resolver person
sec version drop-previous resolver company
sec version drop-previous extractor <extractor-id>
```

### S-1 extraction

S-1 prospectuses are narrative HTML (not structured XML), so the `S-1` extractor
parses the SGML header deterministically and uses AI structured generation to
extract management, beneficial-ownership, and related-party entities/figures.

```bash
# Fetch + AI-extract S-1 management / beneficial-ownership / related-party data
sec fetch form <cik> S-1

# Dead-letter worklist (version-fixable extraction failures, per filing+section)
sec extractor dead-letters S-1             # list pending entries
sec extractor dead-letters S-1 --eligible  # count entries eligible for retry
sec extractor retry-dead-letters S-1       # re-run filings eligible under the current version
```

`sec version promote extractor S-1` announces how many dead-letter entries became
eligible. Configure the model via `SEC_S1_MODEL` (default `claude-sonnet-5`)
and an optional confidence floor via `SEC_S1_CONFIDENCE_FLOOR`. All extractors
share a general default model (`SecModelDefault` in `src/config/Constants.ts`);
set `SEC_MODEL_DEFAULT` to change every extractor at once, and a per-extractor
env var (e.g. `SEC_S1_MODEL`) to override just one. CLI startup registers these
model ids (the default plus any set overrides, plus the local HFT default
`SecHftModelDefault`) into the global model repository via `registerSecModels`
(`src/config/registerModels.ts`). `secModelRecord` dispatches on id shape — a
`gguf:` id → a `LOCAL_LLAMACPP` record, a HuggingFace `org/name` id → an
`HF_TRANSFORMERS_ONNX` record, a `gpt-*`/`o*` id → an `OPENAI` record, a
`gemini-*` id → a `GOOGLE_GEMINI` record, a `grok-*` id → an `XAI` record, a
`deepseek-*` id → a `DEEPSEEK` record, otherwise an `ANTHROPIC` record — and each
explicitly declares the `json-mode` capability
`StructuredGenerationTask` gates on (the installed provider's
capability inference doesn't recognize newer ids like `claude-sonnet-5`,
`gpt-5.5`, `gemini-3.1-pro-preview`, `grok-4.5`, or `deepseek-v4-pro`). The
`deepseek-*` prefix is matched only after the HuggingFace `org/name` check, so a
`deepseek-ai/…` repo id still routes to the local ONNX provider. So
`getGlobalModelRepository().findByName(id)` resolves any of them. Startup also
registers the AI **providers** via `registerSecProviders`
(`src/config/registerProviders.ts`): five inline cloud providers — Anthropic
(`ANTHROPIC`, `ANTHROPIC_API_KEY`), OpenAI (`OPENAI`, `OPENAI_API_KEY`), Google
Gemini (`GOOGLE_GEMINI`, `GEMINI_API_KEY`), xAI Grok (`XAI`, `XAI_API_KEY`), and
DeepSeek (`DEEPSEEK`, `DEEPSEEK_API_KEY`) — plus the worker-backed local providers
HuggingFace Transformers ONNX
(`HF_TRANSFORMERS_ONNX`, `hftWorker.ts`) and node-llama-cpp GGUF
(`LOCAL_LLAMACPP`, `llamaCppWorker.ts`). Each provider registers defensively (a
load failure or missing key warns and is skipped). Absent a working provider /
key, each AI section dead-letters instead of aborting the filing.

A `MODEL_RESOLUTION_ERROR` dead-letter (model/provider was unavailable) is
retryable under the **same** extractor version — `retry-dead-letters` recovers it
once the model/provider is registered, no version bump required
(`MODEL_ERROR_REASON_CODES` in `ExtractionDeadLetterSchema.ts`). Every other reason
code stays version-gated (fix the extractor, bump the version, then retry).

### Download-before-use harness

Local model weights must be on disk before generation, and providers differ on
when that happens: cloud models have nothing to download; HuggingFace ONNX
auto-fetches on first generation; but node-llama-cpp (GGUF) loads its
`model_path` directly and never fetches at generation. `EnsureModelDownloadedTask`
(`src/task/model/EnsureModelDownloadedTask.ts`) is the single seam that normalizes this.
It takes a **model id** and figures out the provider from the id shape via
`secModelRecord` (no resolved `ModelConfig` handed in), then owns and runs
`ModelDownloadTask` for the local providers (no-op for cloud, memoized per model
id so a per-section sweep pays the download once) and skips a bare-path GGUF (no
`model_url` — the file is assumed on disk).

The download runs as an **owned** subtask (`context.own`), so it is registered in
the running task's graph and inherits its registry + abort signal. Passing the
**real** `IExecuteContext` (not a throwaway stub) is what surfaces download
progress — the download run-fn's `phase` events are forwarded to
`context.updateProgress`, which the `@workglow/cli` progress UI (`withCli`)
renders, so a multi-GB GGUF/ONNX fetch shows a live percentage instead of a silent
hang (and `context.signal` aborts it on Ctrl-C). `prefetchModel(modelId, context)`
is the best-effort wrapper the CLI-task boundaries call (own + run the task,
swallowing failures): the AI form processors (`processFormS1` / `processForm424` /
`processMergerProxy` / `processRedemption8K` / `processLoi8K`, via a `context`
threaded through `storageArgs`) prefetch once after resolving their model, and the
eval loops prefetch before their timed sections (so download time isn't charged to
a model's measured latency). `runStructured` keeps an `ensureModelDownloaded` call
as a per-section correctness safety-net — it downloads silently if a model was
never prefetched (e.g. a sub-extractor's distinct model), but the progress-bearing
fetch lives at the task boundary.

To make GGUF weights fetchable rather than pre-staged, a `gguf:` id may be a
**remote URI** — a node-llama-cpp HuggingFace URI (`gguf:hf:org/repo:Q4_K_M`) or
an `https://` URL — which `secModelRecord` turns into a `model_url` (download
source) plus a local `model_path` / `models_dir` under the GGUF models dir. A
plain `gguf:` path (`gguf:Model-Q4.gguf`, `gguf:/abs/Model.gguf`) stays a
load-directly local file, unchanged.

### AI SPAC content classifier (SIC-miscoded SPACs)

Deterministic SPAC classification keys off the SGML-header SIC (`6770` →
`is_spac`, `classifier_source = "sgml-header"`). A SPAC filed under a miscoded or
absent SIC would be missed, so `processFormS1` runs an **AI content classifier**
behind the `S1Classification.classifier_source = "ai"` seam. It is gated twice to
stay cheap: it only runs when the deterministic path did **not** already flag the
filing, and only when a cheap keyword heuristic (`looksLikeBlankCheck`,
`s1/spacContentHeuristic.ts` — ≥2 distinct blank-check signals) trips on the
prospectus-summary prose. A confident `spac` verdict (`extractSpacClassification`
distinguishes a true SPAC from a `shell` or `operating` company) flips the local
`is_spac`, overwrites the classification row with `classifier_source = "ai"`, and
mints the known-SPAC `spac` row so de-SPAC lifecycle extractors can attach. A
confident "not a SPAC" is the expected outcome and auto-resolves its
`MODEL_EMPTY` dead-letter (mirroring the LOI detector); when the model is
unavailable, a blank-check-looking filing dead-letters `spac-classification`
(`MODEL_RESOLUTION_ERROR`) so a retry runs it once a model exists. Configure via
`SEC_S1_CLASSIFIER_MODEL` (default `SecModelDefault`) and
`SEC_S1_CLASSIFIER_CONFIDENCE_FLOOR` (falls back to `SEC_S1_CONFIDENCE_FLOOR`).
The `spac-classification` entry in `EVAL_EXTRACTORS` (a true-SPAC positive plus
shell / operating-company negatives) ranks it through `sec eval extract`.

### Model comparison harness

`sec eval extract` compares extraction models on **correctness, speed, and cost**
so you can find the cheapest/fastest model that still extracts correctly. It runs
committed golden fixtures (`src/eval/fixtures.ts` — realistic section prose with
hand-authored `expected` rows) through each candidate model and ranks them.
Registration in `EVAL_EXTRACTORS` does **not** imply a fixture: `--extractor`
errors out for an extractor with none (rather than sweeping zero runs and
reporting a vacuous pass), and its help lists only the scorable ones.
`related-party` and `offering-terms` still have no fixture — `offering-terms` is
covered instead by `sec eval unit-terms` against the embarc truth set.

```bash
sec eval extract                              # default: haiku vs sonnet
sec eval extract --models "claude-haiku-4-5,onnx-community/Qwen3-4B-Instruct-2507-ONNX"
sec eval extract --extractor management --format json

# Cross-provider head-to-head: Anthropic vs OpenAI vs Gemini vs xAI vs DeepSeek.
# Each id routes to its provider by shape (gpt-*→OpenAI, gemini-*→Gemini,
# grok-*→xAI, deepseek-*→DeepSeek); needs the matching *_API_KEY per provider
# used. An id a provider doesn't serve
# is recorded as a failed run, not a crash — verify ids against each provider's
# models endpoint (e.g. GET https://api.openai.com/v1/models, /v1/models on
# api.x.ai, .../v1beta/models on generativelanguage.googleapis.com,
# /models on api.deepseek.com).
sec eval extract --models "claude-opus-4-8,claude-sonnet-5,claude-haiku-4-5,\
gpt-5.5,gpt-5.4-mini,gemini-3.1-pro-preview,gemini-3-flash-preview,grok-4.5,\
deepseek-v4-flash,deepseek-v4-pro"
```

DeepSeek is the cheapest cloud tier in the table by a wide margin — at list price
`deepseek-v4-flash` is $0.14/1M input vs `claude-haiku-4-5`'s $1.00, which works out
to roughly **8x cheaper** on an input-heavy extraction section. That is a reason to
_rank_ it, not to adopt it: score it against golden truth
(`sec eval s1 --reference golden`) before trusting it for production extraction.
Its cost line uses DeepSeek's **cache-miss** input price, since each section is a
distinct prompt that never hits the context cache; DeepSeek has also announced
(not yet enabled) 2x peak-hour pricing, which the table does not model.

> ⚠️ **DeepSeek's `json-mode` is not schema-enforced.** The API supports only
> `response_format: {type: "json_object"}` — it rejects the OpenAI `json_schema`
> form — so the provider passes the schema in the _prompt_ and the model is free
> to ignore it. That is weaker than every other extraction path here: Anthropic /
> OpenAI / Gemini enforce the schema server-side, and llama.cpp constrains
> generation with a grammar. `StructuredGenerationTask` still re-validates the
> parsed object, so a bad shape fails loudly (and dead-letters) rather than
> corrupting data — but expect a higher schema-failure rate than the cost table
> alone suggests, and weigh that against the savings when ranking it.

A local HuggingFace model can be set via `SEC_HFT_MODEL` (e.g.
`onnx-community/Qwen3-4B-Instruct-2507-ONNX`). Only **non-thinking** instruct
models work for `json-mode` — a thinking model wraps the JSON in reasoning.

> **Verdict: use the cheap cloud tier, not a local model.** Measured against
> golden truth on the committed `beneficial-ownership` sections, **haiku-4-5
> matches sonnet-5 at 100% agreement / recall / precision for ~2.8x less** — so
> that is where the savings are. Small local models are not a substitute for
> production extraction: they hard schema-fail on real sections (emitting
> `owner_kind` values outside `person|company`, share counts in the `confidence`
> field), and they hallucinate entities memorized from pretraining — one returned
> a well-known SPAC sponsor for an unrelated issuer's ownership table, which is
> the failure mode that matters most for a filings dataset. Rank any candidate
> yourself with `sec eval extract` / `sec eval s1 --reference golden` rather than
> trusting a headline number.

> HFT chat-template workaround: transformers.js 4.2.0 bundles jinja **0.5.6**,
> which predates the `{% generation %}` template-tag strip, so a newer template
> carrying `{%- generation -%}` markers otherwise throws
> `Unknown statement type: generation`. `hftWorker.ts` calls
> `patchHftChatTemplateGenerationTags` (`src/config/patchHftChatTemplate.ts`)
> to strip those inert training-only markers before the tokenizer compiles the
> template. Remove once the provider's transformers.js bundles a newer jinja.

- **Correctness** — `scoreExtraction` (`src/eval/scoreExtraction.ts`) aligns candidate
  rows to `expected` by a key field (e.g. `full_name`) and scores field-level agreement,
  normalized (case/whitespace) and forgiving of provenance fields. Reports `score`
  (names + titles), `found` (entity recall), and `prec` (1 − hallucinated rows).
- **Cost** — the generation task exposes no token usage, so cost is **estimated**
  (`src/eval/modelPricing.ts`: ~4 chars/token × public per-M pricing; local models $0).
  Absolute dollars are approximate; the ranking is what matters.
- **Speed** — measured wall-clock latency per extraction.

Models are registered on demand via `registerModelIds`, so any candidate id works;
a model that fails to resolve or errors on a fixture is recorded as a failed run
rather than aborting the sweep. Add an extractor by registering it in
`EVAL_EXTRACTORS` and adding a matching fixture. The scorer and pricing are unit-
tested; the live run makes real Anthropic calls (and downloads the ONNX model on
first HFT use).

`scoreExtraction` de-duplicates candidate (and reference) rows on the extractor's
key field before scoring: a model that emits the same entity twice is over-producing
_rows_, not inventing distinct hallucinations, so precision is computed over
**distinct** rows (`candidateDistinct`). The oracle table shows `rows` (raw) and
`dist` (post-dedupe) side by side — the gap is duplicate over-production.

#### Oracle over real S-1s (`sec eval s1`)

Golden fixtures are synthetic; `sec eval s1` instead runs a `--reference` model
as the "truth" over **real committed S-1 sections**, then scores each
`--candidate` on agreement/recall/precision against it. The reference defaults to
**`claude-opus-4-8`** — a model oracle caps every candidate at its own accuracy,
so it should be the strongest model available, not the one you are evaluating.
`realSections.ts` segments the HTML into management / beneficial-ownership /
related-party prose. The reference retries a few times per section (strong models
intermittently emit a nested array as a JSON _string_ the strict schema rejects);
a section the reference still fails is dropped from scoring.

**Golden truth (`--reference golden`).** A live reference model is not ground
truth — even the strongest model drops or invents the odd role, capping
achievable agreement and penalizing a correct candidate. `--reference golden`
scores candidates against **committed labels** (`src/eval/goldenS1Labels.ts`)
instead of a model run — no reference API call, `$0`, deterministic. Only sections
with a golden entry are scored (the rest are reported as skipped); currently the
four committed `management` sections and all five `beneficial-ownership` sections.
Titles are stored in canonical (`normalizeManagementTitles`) form and unit-tested
to stay canonical. Use golden truth to tell which model is actually _correct_
(not merely reference-like); use a model reference to sweep sections that aren't
hand-labeled.

> **Why golden truth matters — a worked example.** The `beneficial-ownership`
> oracle numbers were long depressed by an _unstated convention_, not by model
> capability. Ownership tables end in an `All officers and directors as a group
(N)` subtotal; the prompt never said whether to emit it, so the reference model
> emitted it for most tables and omitted it for others — and, typed
> `owner_kind: "company"`,
> the S-1 persist path resolved those subtotal labels into the **canonical
> company tier** while their aggregate share counts double-counted the members
> above them. With the convention pinned (prompt + `isOwnershipGroupSubtotal`
> guard) and golden labels committed, sonnet **and** haiku both score 100%
> agreement / recall / precision across all five sections — with haiku at ~2.8x
> lower cost. A model-reference oracle could never have surfaced this: the
> reference _was_ the model making the mistake.

```bash
# Score candidates against human-verified truth (deterministic, no ref call)
sec eval s1 --reference golden --models "gpt-5.4-mini,gemini-3-flash-preview"

# Model oracle (defaults to --reference claude-opus-4-8) over unlabeled sections
sec eval s1 --models "claude-haiku-4-5" \
  --extractors "management,beneficial-ownership,related-party"

# Run over a larger fetched sample (gitignored cache) instead of the committed set:
sec fetch s1-fixtures -c 20
sec eval s1 --models "claude-haiku-4-5" --dir src/sec/html/mock_data/s1/.cache
```

The oracle streams per-section progress to **stderr** (`[i/N] filing extractor
(chars) ref/cand: ok/FAIL ms rows`) so a long local-model run isn't blind; `--format
json` on stdout stays clean. Large sections (40–57k chars) dominate wall-clock —
sonnet takes ~20s each, and a local HFT model minutes.

#### Evaluating Bonsai 27B (local GGUF)

PrismML **Bonsai 27B** (Qwen3.6-based, Apache-2.0) runs through the existing
node-llama-cpp path — there is **no special model id or route**; it is just a
`gguf:` model like any other local GGUF. Point a `gguf:` candidate at a HuggingFace
quant URI and the download-before-use harness fetches it into the GGUF models dir
(`$SEC_GGUF_DIR`, else `$SEC_RAW_DATA_FOLDER/gguf`, else `./models`) on first use;
or pre-stage the file yourself and pass its local path:

```bash
# Remote URI — the harness downloads it before the run (into the GGUF models dir)
sec eval s1 --reference claude-sonnet-5 \
  --models "gguf:hf:prism-ml/Ternary-Bonsai-27B-gguf:Q2_0" \
  --extractors "management,beneficial-ownership,related-party"

# Or pre-stage the quant and pass its local filename / absolute path instead
huggingface-cli download prism-ml/Ternary-Bonsai-27B-gguf \
  Ternary-Bonsai-27B-Q2_0.gguf --local-dir "${SEC_GGUF_DIR:-./models}"
sec eval s1 --reference claude-sonnet-5 \
  --models "gguf:Ternary-Bonsai-27B-Q2_0.gguf" \
  --extractors "management,beneficial-ownership,related-party"
# (an absolute path also works: --models "gguf:/abs/path/Ternary-Bonsai-27B-Q2_0.gguf")
```

A 27B model wants a GPU/Metal box with enough VRAM (this is a run-on-your-Mac
eval, not a CI one); raise `SEC_GGUF_CONTEXT` (e.g. `32768`) for the largest S-1
sections. Bonsai is a **thinking** model, but the llama.cpp `json-mode` here is
**grammar-constrained**, so structured extraction stays schema-valid without a
reasoning preamble leaking in — unlike the HFT ONNX thinking-model caveat above.

### Company facts outcome tracking

`processed_facts` rows carry `reason_code` / `detail` / `attempts`. A companyfacts
404 (the entity has no XBRL data — most filer CIKs) is recorded as a _successful_
`NO_XBRL_FACTS` outcome and never retried. `FETCH_ERROR` (transient HTTP/network),
`PARSE_ERROR` (code-fixable), and `STORE_ERROR` rows are failures; `attempts`
counts consecutive failures and resets on success.

```bash
sec update facts --retry-failed   # also re-fetch CIKs whose last facts processing failed
```

A curated sample of real S-1 prospectus HTML (incl. ≥3 SPACs, SIC 6770) is
committed under `src/sec/html/mock_data/s1/` (see its `SOURCES.md`) and exercised
by `parseEdgarHtml.golden.test.ts`. To refresh / grow the sample on demand into a
gitignored cache:

```bash
sec fetch s1-fixtures                 # ~10 real S-1s (>= 3 SPACs) -> mock_data/s1/.cache/
sec fetch s1-fixtures -c 20 --min-spac 5
```

#### iXBRL / XBRL facts

Modern S-1s embed inline XBRL (`ix:nonFraction` / `ix:nonNumeric` facts against the
`dei`, `us-gaap`, and `spac` taxonomies); older submissions may carry a standalone
XBRL instance document (`EX-101.INS`); and since the filing-fee modernization the
fee table is a separate `EX-FILING FEES` exhibit tagged against the `ffd` taxonomy
(it includes `ffd:MaxAggtOfferingPric` / `ffd:TtlOfferingAmt` — the registered
offering size as a deterministic fact). `src/sec/xbrl/` parses these into a shared
fact/context/unit model (no taxonomy/linkbase processing), and `processFormS1`
runs this deterministic pass before AI extraction:

- every fact is persisted to the `xbrl_fact` table (`src/storage/xbrl/`), keyed
  `(accession_number, fact_index)` with the context period/dimensions and resolved
  unit denormalized onto the row; fee-exhibit facts share the accession with
  `source = "fee-exhibit"` and continue the primary document's `fact_index` sequence;
- the dei cover-page facts (registrant name, incorporation state, address, phone)
  upgrade the issuer company observation (`source_context.attributes_source = "xbrl-dei"`);
- XBRL failures never abort the filing — extraction degrades to the untagged path.

`parseToBlocks` skips `display:none` subtrees so the hidden `ix:header` metadata
block does not leak into the prose handed to the AI section extractors.

Non-numeric date facts are normalized to ISO-8601 via the ixt date transforms in
`ixtTransforms.ts` (e.g. `dei:DocumentPeriodEndDate` tagged
`ixt:date-monthname-day-year-en` → `2026-03-31`). Both the TR1 concatenated
(`datemonthdayyearen`, `dateslashus`/`dateslasheu`) and TR3/TR4 hyphenated
(`date-monthname-day-year-en`, `date-month-day-year`, …) spellings are handled;
a registered date transform that cannot parse its text keeps the trimmed raw
text rather than blanking the fact.

**424 prospectuses** (`424A`, `424B1`–`424B5`, `424B7`; extractor id `424`) run
`processForm424`: every variant gets the deterministic XBRL pass (pay-as-you-go
424B2s carry `ffd:NrrtvMaxAggtOfferingPric` and `ffd:RegnFileNb`, which ties the
prospectus back to its registration file number) and an issuer observation that
resolves to the same canonical company as the registration statement
(`relation: "424:issuer"`). The **priced** forms (`424B1` / `424B4`) additionally
run the AI offering sections — offering terms, underwriters, use of proceeds —
recording the **final** deal under extractor id `424`, alongside the S-1's
registered/anticipated terms (compare `spac_unit_terms` / `offering_terms` rows
across the two extractor ids). Fee-prepaid 424s (e.g. SPAC 424B4s under Rule
456(a)) carry no fee exhibit and no XBRL; when the prospectus body is untagged,
the fee exhibit's dei facts are the cover-page fallback for issuer enrichment.
The offering-sections logic and the per-section dead-letter ceremony are shared
with the S-1 processor (`s1/offeringSections.ts`, `s1/sectionRunner.ts`).

```bash
sec fetch form <cik> 424B4        # fetch + process a priced prospectus
```

```bash
# Stored XBRL facts for a filing (dimensional facts show their Axis=Member qualifiers)
sec query xbrl <accession> [--concept TrustAccount] [--numeric-only] [--format json]

# A concept's series across ALL of an issuer's filings (e.g. trust balance over time);
# the result carries an Accession column and is ordered by (accession, fact_index)
sec query xbrl --cik <cik> --concept AssetsHeldInTrust
```

The committed Churchill Capital Corp XII fixture (`s1_2114227_...htm`, a 2026 SPAC
with full `spac`-taxonomy tagging) pins the parser via `parseXbrl.golden.test.ts`.

#### Offering terms / underwriters / use of proceeds

S-1/F-1 prospectuses also yield the deal itself: offering terms (equity →
`offering_terms`, SPAC units → `spac_unit_terms`), a point-in-time exact ticker
series (`issuer_ticker`, distinct from the mutable submissions-API `entity_tickers`),
use-of-proceeds line items, and underwriters on the company tier rolled up to an
`underwriter-family` resolver tier (mirroring sponsor families). The segmenter
recognizes focused `The Offering` / `Underwriting` / `Use of Proceeds` / `The Sponsor`
sections; the last one also gives SPAC sponsor extraction a dedicated home (it falls
back to concatenated section text when the heading is absent).

```bash
# IPOs underwritten by a family (alias-aware)
sec underwriter by-family "Goldman Sachs"

# Underwriter-family alias management
sec canonical underwriter-family alias "<from>" "<into>" --reason "subsidiary"
sec canonical underwriter-family alias-remove "<name>"
sec canonical underwriter-family alias-list [--orphans]

# Point-in-time ticker series for an issuer
sec issuer tickers <cik>

# Registered (S-1) vs final priced (424B1/424B4) terms, with deltas
sec issuer deal <cik> [--format json]
```

#### Sponsor promote economics

Alongside the unit terms, the SPAC prospectus's "The Offering" / "The Sponsor"
prose yields the **sponsor promote**: founder (Class B) shares and their
percentage, private-placement (sponsor) warrant count / price / public warrant
coverage, and the trust deposit per public share and in total. These land in a
dedicated `spac_promote_terms` table keyed `(extractor_id, accession_number)` —
same shape as `spac_unit_terms`, so the S-1's registered promote and a
424B1/424B4's final promote compare across extractor ids. Extraction rides the
shared offering-sections runner (`runOfferingSections`, SPAC-only) so both the
S-1 and priced-424 pipelines populate it; the `sponsor-promote` entry in
`EVAL_EXTRACTORS` ranks the prompt through `sec eval extract`.

> Note: the version ceremonies `coverage` / `drop-previous` and the batch `resolve`
> command are **not** supported for the family-tier resolver kinds
> (`underwriter-family`, `sponsor-family`) — they intentionally error rather than
> operate on the company tier. Family-tier coverage/purge wiring is deferred (see the
> status doc's deferred cleanups).

### SPAC consolidated report

A CIK-keyed `spac` row consolidates the SPAC lifecycle for a quick report:
status, three-era names/SIC/tickers (`spac_*` / `post_merger_*` / `current_*`),
amounts (`ipo_proceeds`, `trust_amount`, `pipe_amount`, `total_redemption_amount`),
and rolled-up key dates. It is **derived** from two append-only tables — `spac_deal`
(one row per business-combination attempt) and `spac_event` (the dated timeline) —
so replays are idempotent; an `as_of` guard protects filing-sourced scalar fields
from out-of-order writes, and `spac_history` + `ChangeLog` version the row.

The IPO half is populated from S-1/DRS (`registration`) and priced 424B1/424B4
(`ipo`). De-SPAC **milestone dates** are populated deterministically from 8-K
item codes (known SPACs only — a `spac` row must already exist): item `1.01` →
`definitive_agreement`, `1.02` → `terminated`, `2.01` → `completed`, `5.07` →
`vote`. These group into `spac_deal` attempts via `deriveDeals`
(recomputed from the event stream on every write, so `deal_index` is stable
across replays) and roll up automatically. `target_name`, `pipe_amount`, and
redemption amounts stay null until the narrative/AI extractors (S-4 / DEFM14A / 425) land — 8-K item codes carry no names or amounts. Still deferred: Form 25/15
de-registration.

**De-SPAC linkage.** When a deal reaches `completed`, the issuer is linked to its
post-merger surviving entity. The rollup (`buildSpacRow`) derives `surviving_name`
from the completed deal's `target_name` (the combined company is named after the
target) and promotes it onto `current_name`. On the item-2.01 8-K,
`SpacReportWriter.recordDeSpacLinkage` additionally reads the SPAC CIK's own
post-close `entity` / `entity_tickers` metadata — the shell keeps its CIK and
renames, so `current_cik` stays null (it differs only for the deferred newco/S-4
case) while `surviving_name` / `post_merger_sic` / `post_merger_tickers` come from
the renamed entity (each set only when it diverges from the SPAC-era value, so
replays are order-safe). Entity metadata usually refreshes _after_ the 2.01 8-K,
so `sec spac backfill-despac` re-runs the linkage over every completed SPAC to
fill the still-null slots from now-current entity data.

**Merger proxies** (`DEFM14A`/`PREM14A`, the `DEFM14C`/`PREM14C` consent statements,
and the `DEFR14A`/`PRER14A` revised proxies; extractor id `merger-proxy`) run
`processMergerProxy` (known SPACs only — a `spac` row must already exist): AI
extraction over the merger / business-combination / PIPE sections records a
per-accession `spac_merger_extraction` row (target name/CIK, PIPE amount, merger
consideration) and observes the target company (`relation: "merger-proxy:target"`,
`target_cik` resolved from the canonical company when it has one). `deriveDeals`
correlates each extraction onto the matching `spac_deal` by filing-date window —
_deriving_ `target_name` / `target_cik` / `pipe_amount` (a later filing supersedes
an earlier one — definitive over preliminary, revised over definitive), which
retires the 8-K path's positional merge-preserve. Only the **definitive merger**
statements `DEFM14A` and `DEFM14C` emit the `proxy` event (→ `proxy_date` /
`status = proxy`): a consent deal (14C) has no `8-K 5.07` vote, so the definitive
14C is its only approval-stage signal. Preliminary (`PREM14A`/`PREM14C`) and revised
(`DEFR14A`/`PRER14A`) proxies are extraction-only. S-4 is deferred (newco-CIK linkage). Configure the
model via `SEC_MERGER_PROXY_MODEL` (default `claude-sonnet-5`) and an optional
confidence floor via `SEC_MERGER_PROXY_CONFIDENCE_FLOOR` (falls back to the shared
`SEC_S1_CONFIDENCE_FLOOR` when unset).

A proxy ingested before its issuer's `spac` row exists (e.g. the S-1 lands later)
hits the known-SPAC gate and no-ops — recording a successful run, so the normal
unprocessed-run sweep never revisits it. `sec spac backfill-merger-proxies`
recovers these: it re-processes known-SPAC merger proxies that still lack a
`spac_merger_extraction` row (mirroring `backfill-redemptions`).

```bash
sec fetch form <cik> DEFM14A             # fetch + extract a merger proxy
sec spac backfill-merger-proxies         # recover proxies gated before their spac row existed
sec extractor dead-letters merger-proxy  # version-fixable extraction failures
sec extractor retry-dead-letters merger-proxy
```

**Redemption actuals** (extractor id `redemption`) are AI-extracted from a known
SPAC's post-vote 8-K narrative. When an 8-K carries item `5.07`, `2.01`, or `8.01`
for a known SPAC, ingestion escalates the fetch to the full submission `.txt` and
reads the primary document + `EX-99.x` exhibits; `processRedemption8K` records a
per-accession `spac_redemption_extraction` row, and `deriveDeals` correlates
`redemption_amount` / `redemption_shares` onto the matching `spac_deal`. The deal
column is the sole source `total_redemption_amount` sums, so redemptions are counted
once. Configure the model via `SEC_REDEMPTION_MODEL` (default `claude-sonnet-5`)
and an optional confidence floor via `SEC_REDEMPTION_CONFIDENCE_FLOOR` (falls back to
`SEC_S1_CONFIDENCE_FLOOR`).

```bash
sec spac backfill-redemptions            # sweep historical known-SPAC trigger 8-Ks
sec extractor dead-letters redemption    # version-fixable extraction failures
sec extractor retry-dead-letters redemption
```

**Letters of intent** (extractor id `loi`) bring back the LOI lifecycle stage
(between `searching` and `deal_announced`). No 8-K item code carries an LOI, so
`processLoi8K` AI-detects "non-binding letter of intent / agreement in
principle / MOU for a business combination" language in a known SPAC's 8-K
narrative (items `1.01`, `7.01`, `8.01` escalate the fetch to the full
submission `.txt`, sharing the redemption path's escalation). A verified
positive records a per-accession `spac_loi_extraction` row (target name, stated
LOI date) and emits an `loi` event (dated by the narrative's LOI date, else the
report/filing date); `deriveDeals` opens/dates the attempt and the rollup lifts
`loi_date` / `status = "loi"` onto the spac row — a later definitive agreement
on the same deal supersedes the LOI stage. "No LOI reported" is the expected
outcome for most trigger 8-Ks, so its `MODEL_EMPTY` dead-letter is auto-resolved
(genuine problems — low confidence, unverified span, nonce mismatch — stay
pending). Configure the model via `SEC_LOI_MODEL` (default `claude-sonnet-5`)
and an optional floor via `SEC_LOI_CONFIDENCE_FLOOR` (falls back to
`SEC_S1_CONFIDENCE_FLOOR`).

```bash
sec spac backfill-lois            # sweep historical known-SPAC trigger 8-Ks
sec extractor dead-letters loi    # version-fixable extraction failures
sec extractor retry-dead-letters loi
```

The LOI prompt is evaluated through the model-comparison harness: the `loi`
entry in `EVAL_EXTRACTORS` plus eight golden 8-K narratives (three LOI
positives, five confusable negatives) in `src/eval/fixtures.ts`, so any model
set can be ranked on it:

```bash
sec eval extract --extractor loi                        # default sweep
sec eval extract --extractor loi --models "claude-sonnet-5,claude-haiku-4-5"
```

```bash
sec spac report <cik> [--format json]   # consolidated report
sec spac history <cik> [--format json]  # state-change history
sec spac backfill-despac [--dry-run]    # refresh post-merger identity for completed SPACs
```

### Generalized extractor backfill

When a new extractor lands, its historical filings are recovered with the
generalized sweep — no bespoke backfill task per extractor:

```bash
sec extractor backfill <extractorId> [--force] [--dry-run]
```

`BackfillExtractorTask` resolves a per-extractor **descriptor**
(`src/task/forms/backfillDescriptors.ts`): every form-routed extractor id
(`FORM_TO_EXTRACTOR_ID` values — `S-1`, `424`, `8-K`, `C`, …) is backfillable
by default over all filings of its forms; extractors whose candidate set is
narrower add a descriptor entry (the `redemption` / `loi` sub-extractors select
known-SPAC trigger-item 8-Ks) and extractors whose recorded success can be a
gated no-op override `filterTodo` (`merger-proxy` keeps candidates lacking a
`spac_merger_extraction` row, since its known-SPAC gate records `success: true`).
The default needing-work predicate is a bulk anti-join against `extractor_runs`
at the active version. Each survivor re-runs `ProcessAccessionDocFormTask`, so
the full form pipeline (and any sub-extractors it gates) runs. The
`sec spac backfill-redemptions` / `backfill-lois` / `backfill-merger-proxies`
commands remain as aliases with the extractor id fixed.

### Editorial data (embarc parity)

`spac.url_sponsor`, `spac.url_spac`, the freeform `spac.details` JSON map, and
`family_description` blurbs have **no reliable SEC-filing source** — they are
hand-curated via the `sec editorial` command group. Spac-row writes go through
`SpacReportWriter.recordEditorial`, which rebuilds at the row's own `as_of`
anchor: values overwrite on re-import but the anchor never advances, and no
automated `record*` writer carries these fields, so filing replays can never
null them. Family descriptions are keyed by `(family_kind, normalized_name)` —
outside the canonical tier — so resolver re-mints / `dropPrevious` never wipe
them.

```bash
sec editorial set <cik> --url-sponsor <url> [--url-spac <url>] [--details '<json>'] [--create-missing]
sec editorial set-family-description "Chardan" --kind underwriter-family "<text>"
sec editorial import data/editorial/spac-editorial.csv [--create-missing] [--dry-run]
sec editorial import data/editorial/family-descriptions.csv
```

The committed CSVs under `data/editorial/` were extracted from the embarc
repo's legacy JSON by a one-off script (not committed; sec.gov links are
excluded as merge pollution — real sponsor sites come from the legacy
`url_sponsors` array). Import skips CIKs with no spac row unless
`--create-missing` (a spac row marks the CIK a known SPAC, gating 8-K/proxy
processing). `family-descriptions.csv` is a header-only template — embarc has
no family blurb data; hand-written blurbs get committed there.

embarc's curated SPAC **unit structure** (`details`: unit price, warrant
fraction, rights) is deliberately **not** imported — the S-1/424
offering-terms extraction derives those figures from filings. Instead it is
committed as an extraction **truth dataset** for the eval harness
(`src/eval/mock_data/embarc-spac-unit-terms.csv`, 1,283 CIKs; loader in
`src/eval/embarcUnitTermsReference.ts`). `sec eval unit-terms` segments each
committed S-1's "The Offering" section, runs `extractOfferingTerms` per
candidate model, and scores price / warrant-fraction / rights-fraction against
embarc's values (rounded to 2 decimals on both sides — `scoreExtraction`
compares numbers exactly and 1/3 repeats):

```bash
sec eval unit-terms --models "claude-sonnet-5,claude-haiku-4-5"
sec eval unit-terms --dir src/sec/html/mock_data/s1/.cache   # larger fetched sample
```

The `offering-terms` entry in `EVAL_EXTRACTORS` also makes the section
available to the model-oracle eval (`sec eval s1 --extractors offering-terms`).

### Reg A / Reg CF / funding portals

All 12 Form C submission types (including post-offering C-U / C-AR / C-TR),
the full 1-A family (including 1-A POS), and CFPORTAL portal registrations
parse and store end to end:

```bash
sec fetch form <cik> C-AR          # post-offering Form C variants
sec fetch form <cik> 1-A           # 1-A, 1-A/A, 1-A POS
sec fetch form <cik> CFPORTAL      # portal registration -> Portal table + observations

sec query crowdfunding --portal <portal-cik>
sec query reg-a --tier Tier2 --status reporting
sec query reg-a-summary <cik>      # counts by status/tier + latest aggregate offering
```

Fixtures: `sec fetch fixtures C-U C-AR C-TR` extends the exempt-offering
mock_data tree (note: the quarterly form.idx endpoint may 403 from cloud
containers; the committed fixtures were sourced from EDGAR daily indexes).
CFPORTAL fixtures live under `src/sec/forms/portal/mock_data/cfportal/`.
`isFormParsingSupported` and `FORM_TO_EXTRACTOR_ID` are kept consistent by
`src/sec/forms/form-wiring.test.ts`.

### Accredited investor portals + Form D attribution (moved to embarc-data)

Accredited-investor portal curation (`accredited_portal` / `accredited_portal_signal`)
and Form D → portal attribution (`form_d_portal_attribution`) are curated/derived
values computed **on top of** SEC data, so they were extracted to the private
**embarc-data** superset. `processFormD` no longer attributes (ingestion only
produces observations), and standalone `sec db setup` no longer creates those
three tables. See embarc-data's docs for the `accredited-portal` commands.

sec exposes the general downstream seams embarc-data (and future features) build on:

- **`registerResolverExtension`** (`src/resolver/resolverExtensions.ts`) — the
  registry every resolver kind registers through: sec's own person / company /
  sponsor-family / underwriter-family resolvers via `registerSecResolvers`
  (`src/config/registerResolvers.ts`), plus downstream kinds like embarc-data's
  `portal-attributor`. It backs the unified `version resolver <kind>` ceremonies
  (`coverage` and `drop-previous` dispatch to the registered kind's closures),
  `componentRegistry`, and `resolverIds`. `ResolverId` is a runtime-validated
  string, not a compile-time union.
- **`registerDatabaseExtension`** (`src/config/databaseExtensions.ts`) — repo
  tokens registered here are created/dropped by `setupAllDatabases` /
  `resetAllDatabases` (i.e. `db setup` / `db reset`) after the built-in SEC
  tables, so a superset's tables are managed by the same commands. `db setup`
  also calls `registerSecResolvers()` so resolver component-version rows seed even
  on the `init` path that skips the CLI preAction hook.

Both seams, plus the observation/versioning/normalization internals a feature
needs, are re-exported from the package barrel (`src/index.ts`).

## Architecture

### Temporal design: history + current state

A core value of the dataset is showing both how filings change data **over
time** and a queryable **current state**:

- **Per-filing / append-only tables** (offering histories, crowdfunding
  offerings & disclosure reports, observations, XBRL facts) are keyed by
  accession or filing date and are never overwritten by later filings — they
  are the time series.
- **Mutable "current" rows** (`Crowdfunding`, `Portal`, `RegAOffering`) must
  reflect the latest filing by **filing date**, not by processing order.
  Every write guards against out-of-order processing (skip when the incoming
  `filing_date` is older than the row's as-of date; unknown dates apply
  as-is) and merges fields the newer filing doesn't carry (e.g. a 1-K has no
  tier; a C-AR has no portal CIK) instead of clobbering them with nulls.
- **History tables** (`CrowdfundingHistory` + `ChangeLog`) version the
  mutable rows so point-in-time state stays reconstructable.
- Worst case, when an extractor bug corrupted data midway through a CIK's
  filing set, re-process the whole CIK's filings (version bump →
  re-extract); the guards above make replays idempotent and order-safe.

### Layered Structure

- **`src/commands/` and `src/cli/groups/`** — Commander CLI command definitions. Every
  subcommand follows the same shape: parse/validate CLI arguments, construct one or more
  task instances (inputs passed via the constructor's `defaults` config), run them as a
  task graph through `runWorkflowCli` (`src/cli/runWorkflow.ts`), then render the returned
  structured output (tables/JSON/text). `runWorkflowCli` pipes the tasks plus an
  `OutputTask` sink into a `Workflow` and executes it via `@workglow/cli`'s `withCli` —
  on a TTY that renders the live `renderWorkflowRun` progress UI, when piped it runs
  plainly — and returns the sink's collected output. Commands hold no business logic:
  work lives in tasks, presentation in the command. Pass task inputs via `defaults`, not
  the graph run-input (arrays in run-inputs can trigger fan-out semantics).
- **`src/task/`** — Workglow task graph tasks (fetch, store, process, query, ceremonies).
  Organized by domain: `ciknames/`, `facts/`, `forms/`, `index/`, `submissions/`,
  `query/`, `db/`, `versioning/`, `resolve/`, `canonical/`, `spac/`, `editorial/`,
  `offering/`, `fixtures/`, `init/`, `eval/`, `model/`. `taskPorts.ts` exports `TaskPorts<T>`, a
  type-level bridge that lets an `interface`-typed result satisfy the `DataPorts`
  constraint on `Task<Input, Output>`.

  **Every task class declares `static readonly title`** — the CLI progress UI labels each
  row with the task's `title`, falling back to the class type name. `taskTitles.test.ts`
  fails the build on a task without one. When a graph runs several instances of the same
  class, or the instance's parameters are what distinguish it (which CIK, which archive,
  which section), pass a per-instance `title` in the task config — the two bulk downloads
  in `sec bootstrap` are `Download submissions` / `Download facts`, not two identical
  `BootstrapDownloadTask` rows. An owned graph or workflow is wrapped in a task the caller
  never sees, so name it through the second argument: `context.own(new Workflow(), { title })`.
- **`src/sec/`** — SEC data parsing and schemas. `forms/` has subdirectories per form category (e.g., `exempt-offerings/`). Each form type has a parser (`.ts`), a TypeBox schema (`.schema.ts`), and optional storage logic (`.storage.ts`). `submissions/` and `indexes/` handle their respective data types.
- **`src/storage/`** — Repository pattern persistence layer. Organized into sub-tiers:
  - **`entity/`, `filing/`, `address/`, `investment-offering/`, `portal/`** — core EDGAR-linked repos (by CIK). Uses junction tables for many-to-many relationships.
  - **`observation/`** — one row per entity mention extracted from a filing, keyed by `(extractor_id, accession_number, observation_index)`. `PersonObservationRepo` and `CompanyObservationRepo` live here. Legacy `person/`, `company/`, and `phone/` tables were replaced by this tier.
  - **`canonical/`** — deduplicated canonical entities (`CanonicalPersonRepo`, `CanonicalCompanyRepo`) with UUID IDs, plus alias tables (`CanonicalPersonAliasRepo`, `CanonicalCompanyAliasRepo`) and identity-link tables (`PersonIdentityLinkRepo`, `CompanyIdentityLinkRepo`) that join observation rows to canonical rows at a specific `resolver_version`. Junction tables for address/phone co-occurrence also live here.
  - **`versioning/`** — `VersionRegistry`, slot ceremonies (`startDev`, `promote`, `rollback`, `dropNext`, `dropPrevious`), extractor run tracking, and semver helpers.
- **`src/task/fetch/`** — SEC-specific fetch tasks with caching and job queue integration.
- **`src/config/`** — Dependency injection setup. `tokens.ts` defines DI tokens, `EnvToDI.ts` reads env vars, `DefaultDI.ts` registers SQLite-backed repos, `TestingDI.ts` registers in-memory repos.
- **`src/types/edgar/`** — TypeScript types for raw EDGAR API responses.
- **`src/util/`** — Database helpers (`db.ts` manages SQLite connection and prepared statement caching).

### Observations & Resolvers

PR4 introduced an observation/canonical/resolver tier on top of raw form storage. Design spec: `/home/user/prd/docs/superpowers/specs/2026-05-22-sec-versioning-pr4-observation-design.md`.

**Four tiers in order:**

1. **Observation** (`src/storage/observation/`) — raw entity mentions extracted from filings. One row per `(extractor_id, accession_number, observation_index)`.
2. **Canonical** (`src/storage/canonical/`) — deduplicated entities with stable UUID IDs. Created once per resolver version; alias tables redirect merged IDs.
3. **Identity link** (`src/storage/canonical/*IdentityLinkRepo`) — join table from `observation_id` + `resolver_version` → `canonical_*_id`. Written inline during extraction.
4. **Junction** (`src/storage/canonical/Canonical*AddressRepo`, `Canonical*PhoneRepo`) — co-occurrence tables associating canonical entities with addresses/phones at a given resolver version.

**`EntityObserver`** (`src/resolver/EntityObserver.ts`) — form storage modules call `observePerson()` / `observeCompany()` on this shared helper instead of writing person/company rows directly. It normalizes the claim, upserts the observation, calls the resolver, writes the identity link, and records address/phone junctions in one step.

**Person titles & dated roles.** Titles are never stored as arrays. The raw tier
stores one row per single title in `person_observation_titles`
(PK `(observation_id, title)` — the title text is the row's identity; source
order is not stored — diffed per title on re-observation and reaped with the
observation); the canonical tier stores one row per **tenure** in
`person_role` (`PersonRoleRepo`): a canonical person holding one canonical title
(via `normalizeManagementTitles` — compound titles split into separate rows) at one
company (`company_cik`), with a required `start_date` (earliest asserting filing
date), an optional `end_date` (null = current), and `last_seen_date` as the
order-safety guard. A claim participates when it carries `filing_date`,
`source_filing_issuer_cik`, and a `role_scope` population tag. Tenures are scoped
by `(extractor_id, role_scope)`, and only forms that enumerate a COMPLETE
population call `observer.closeUnassertedPersonRoles(...)` after their person loop
— currently Form D related persons (`form-d:related-person`) and the S-1
management section (`s1:management`); everything else (signatures, sales-comp
recipients, Section 16 owners, CFPORTAL contacts/owners) is assert-only, because
absence there means nothing. Closure is guarded by `filing_date >
last_seen_date` (re-checked under a per-tenure lock), so out-of-order replays
never close a role a newer filing asserts; a re-extraction that now finds a
person re-opens the tenure its own accession closed (absorbing any interposed
return tenure), and one that no longer finds a person it alone supported
deletes the phantom row; an earlier out-of-order roster tightens a closed
tenure's end back to the first non-asserting filing; a departure-and-return
yields two tenure rows. Roster closure is completeness-gated: S-1 management
only when no extracted row was dropped by filtering, Form D only when at least
one person was actually observed. Placeholder
titles ("Signer", "Authorized Representative", "Sales Compensation Recipient",
"Connection") stay on the observation title rows but never mint tenures. Closure
is alias-aware: a roster asserting a merged person under the alias target does
not close the retired id's open tenure. `person_role`
rows are resolver-versioned like the junctions: purged by `dropPrevious` (person),
rebuilt by re-extraction replays (batch `resolve` rebuilds identity links only,
same as junctions). Query with `sec query person-roles <cik> [--current]`; the
`sec query persons` titles column joins from the child table. Design spec:
`prd/docs/superpowers/specs/2026-07-28-sec-dated-person-roles-design.md`.

**`PersonResolver` / `CompanyResolver`** (`src/resolver/`) — resolution algorithms. For persons: CIK fast-path, then normalized-name + issuer-CIK fallback. For companies: CIK → CRD → normalized-name cascade. Both create a fresh canonical row on first sight and delegate alias resolution to the alias repo.

**`VersionRegistry` and slot ceremonies** (`src/storage/versioning/`) — each extractor and resolver has three slots: `previous`, `current`, `next`. Ceremonies:

- `startDev` — opens a new dev cycle (populates `next`; patch bumps update `current` in place).
- `promote` — rotates `next → current → previous`. Major bumps enforce a coverage gate.
- `rollback` — swaps `previous` and `current`.
- `dropNext` — discards an in-flight cycle.
- `dropPrevious` — clears the previous slot and purges associated data (extractor runs or resolver identity-link/canonical rows).

### SQLite initialization

`src/sec.ts` invokes **`Sqlite.init()`** when the installed `workglow` package defines it (`typeof Sqlite.init === "function"`), so newer Workglow releases load the SQLite binding before `getDb()` opens a database. Older `workglow` versions without `init` skip this step.

**`getDb()` is SQLite-only.** It throws `SecCliConfigurationError` when `SEC_DB_TYPE !== "sqlite"` to prevent the silent data divergence that occurred before (`getDb()` would open a stray SQLite file even under Postgres, and rows written through it never reached the configured backend).

Code that needs a raw SQL fast path beyond what `ITabularStorage` exposes dispatches through **`resolveSqlBackend(repo?)`** (`src/util/sqlBackend.ts`, also exported from the barrel): SQLite → `getDb()`, Postgres → `getPgPool()`, otherwise → the repository (tests / in-memory). `"sqlite"` requires the full production config, not just `SEC_DB_TYPE` — `getDb()` dereferences `SEC_DB_FOLDER` and `SEC_DB_NAME` unconditionally.

Two guards override the configured backend and force the repository path:

- **Dry run.** `--dry-run` is enforced by `createStorage` wrapping every storage in `ReadOnlyTabularStorage` (writes no-op, reads forward). A raw-SQL path goes around that wrapper and would commit for real, so `resolveSqlBackend` returns `"repository"` whenever `isDryRun()`. The wrapper forwards no `isDurable()`, so the durability guard cannot stand in for this one.
- **A non-durable repo** — **pass the repo whenever you have one.** An in-memory store is invisible to `getDb()`/`getPgPool()`, so a fast path would silently target a different store. This is reachable in one process, not merely across test files: `EnvToDI` defaults `SEC_DB_TYPE` to `"sqlite"` and `.env.test` supplies `SEC_DB_FOLDER`/`SEC_DB_NAME` to the vitest workers, so anything running `EnvToDI` (or a CLI preAction hook) while holding an in-memory repo satisfies every token check. Across test *files* the registry is already clean — `resetDependencyInjectionsForTesting` strips these tokens (they are in `ENV_DERIVED_TOKENS`) and vitest runs `isolate: true` with `pool: "forks"` — so the guard is about in-process mixing, not leakage.

Call sites: `cikNameBulkWriter.ts`, `feedFilings.ts`, `Form8KEventReplace.ts`, `SpacDealReplace.ts`, `personObservationTitleBulkReader.ts`.

The read-side reason to reach for it is the `IN`-list: `ITabularStorage.query` matches one column value, so "rows for these N ids" is N queries through the abstraction. `readTitlesForObservations` (`src/storage/observation/`) is the worked example — it backs `PersonObservationTitleRepo.listForObservations`, which joins titles onto a page of person observations in one statement (chunked only where SQLite's bind-parameter cap forces it) instead of one query per person.

### Dependency Injection

Uses the `workglow` package’s `globalServiceRegistry` with typed tokens. Production uses `SqliteTabularRepository`, tests use `InMemoryTabularRepository`. Call `resetDependencyInjectionsForTesting()` from `src/config/TestingDI.ts` in test setup.

### Schema Pattern

Schemas use TypeBox (v1, imported as `typebox`). Each storage module exports:

- A TypeBox schema (e.g., `AddressSchema`)
- Primary key name constants (e.g., `AddressPrimaryKeyNames`)
- A DI token (e.g., `ADDRESS_REPOSITORY_TOKEN`)
- A repo class with domain-specific save/query methods

### Environment Variables

Set in `.env.local` (see `.env.test` for test defaults):

- `SEC_RAW_DATA_FOLDER` — path to raw downloaded data
- `SEC_DB_FOLDER` — path to SQLite database directory
- `SEC_DB_NAME` — database name (default: `edgar`)
- `SEC_DB_TYPE` — `"sqlite"` (default) or `"postgres"`
- `SEC_PG_URL` — PostgreSQL connection string (takes precedence over individual PG vars)
- `SEC_PG_HOST` — PostgreSQL host (default: `localhost`)
- `SEC_PG_PORT` — PostgreSQL port (default: `5432`)
- `SEC_PG_USER` — PostgreSQL user
- `SEC_PG_PASSWORD` — PostgreSQL password
- `SEC_PG_DATABASE` — PostgreSQL database name (default: `edgar`)
- `SEC_FIXTURES_DIR` — root under which `sec fetch fixtures` / `sec fetch s1-fixtures` write their gitignored cache (default: cwd). Written output goes to `<SEC_FIXTURES_DIR>/.sec-fixtures/exempt-offerings/` and `<SEC_FIXTURES_DIR>/.sec-fixtures/s1/.cache/` — never into the source tree or the bundled `dist/`.
- `SEC_S1_MOCK_DIR` — override the committed S-1 fixtures directory read by `sec eval s1` and `loadRealS1Sections`. Falls back to the built-tree copy, then the source-tree copy.
- `SEC_UNIT_TERMS_REF` — override the embarc unit-terms reference CSV read by `sec eval unit-terms` and `loadEmbarcUnitTermsReference` (mirrors `SEC_S1_MOCK_DIR`). A downstream package consuming the published tarball (which ships no `mock_data/`) points this at its own vendored copy. Fail-fast semantics: when the env var is set, a missing file throws (naming the env var and the path) instead of silently falling through to the package-relative default, so a typo cannot masquerade as "fixture missing, using default". When unset, resolves the package-shipped CSV (dist copy in the built tarball, src copy in dev).

## TypeScript Conventions

From `.cursor/rules/`:

- Use **Bun** runtime, not Node.js (`bun test`, `bun run`, etc.)
- **No default exports** (use named exports)
- **No enums** — use `as const` objects instead
- **`import type`** for type-only imports; merge when mixed with value imports
- **Interfaces over type intersections** (`interface extends` instead of `&`)
- **`readonly` properties** by default on object types
- **Explicit return types** on top-level module functions (except JSX components)
- **Optional properties sparingly** — prefer `string | undefined` over `?: string` to force explicit passing
- **Discriminated unions** for modeling variant data shapes
- Use `as any` only inside generic function bodies when TypeScript cannot narrow correctly
- Concise JSDoc only when behavior is non-obvious; use `@link` for cross-references

## Formatting

Prettier: 100 char print width, 2-space indent, double quotes, trailing commas (es5), semicolons.
