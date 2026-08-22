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
bun run format               # Prettier write (run before pushing)
bun run format-check         # Prettier check — CI runs this
bun run typecheck-tests      # Typecheck the test files
```

CI runs `format-check` → `build` → `test`, cheapest first.

`typecheck-tests` is a separate script because the test files are **excluded
from the base `tsconfig.json`** and vitest transpiles without typechecking, so
nothing else ever type-checks them: `bun run build` and `bun run test` both pass
over a test file whose types are wrong. It is **not** in CI yet — the suite
currently reports 122 errors across 37 files, and a step that is red the day it
lands teaches everyone to ignore it. Run it locally on the files you touch, and
wire it into `test.yml` in the change that gets the count to zero.

The CLI entrypoint is `src/sec.ts` and uses Commander for subcommands (e.g., `./src/sec.ts company-submissions 1018724`).

Source is not shipped in the tarball. `use-source` is a workspace-local `bun link` flow that reads directly from the linked working copy on disk, so consumers using `bun link @workglow/sec` see live source without needing `src` inside `node_modules/@workglow/sec/`. Do not add `src` back to `files` in `package.json` — the `prepack-check` script guards this and CI will fail.

`use-source` does not edit `package.json`. `exports` keeps pointing at `./dist/*`, and the script writes re-export stubs into the gitignored `dist` folder (`dist/index.js` → `src/index.ts`, plus a `dist/sec.js` bin stub so the linked CLI runs live source), so switching modes leaves `git status` clean. `bun run use-dist` removes the stubs — identified by a `@workglow-source-stub` sentinel, so real build output is never deleted — and rebuilds; `--no-build` skips the rebuild. Finding no stubs is reported but does **not** skip the rebuild: `dist/` is gitignored, so "no stubs" most often means it was deleted, and returning early left the developer with "already in dist mode", no dist at all, and nothing saying why the build never ran. `prepack-check` fails if any stub is still present.

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
dates → 404) is warned and left unmarked to retry next run. A day whose download
or extraction **throws** is counted in `failed` with a short reason and also left
unmarked — a range can be thousands of days, and the ones already extracted are
worth keeping. Backend-dispatched day/filing queries (`feedFilings.ts`) mirror
`createCikNameBulkWriter` (SQLite → `getDb()`, Postgres → `getPgPool()`, else
the repository).

#### The two bulk downloads run on the task framework

Both the Feed tarball and the bulk archives (`submissions.zip`,
`companyfacts.zip`) used to call raw `fetch()` — the only way to avoid
materializing a multi-GB body before `FetchUrlTask` could stream. Each is now a
two-node subgraph instead, so the largest downloads in the system keep the
memory ceiling AND get back SafeFetch's redirect/SSRF checks, the SEC rate
limiter, `SecFetchJob`'s retry/backoff and the 429 cluster-throttle signal:

```
SecFetchTask { response_type: "stream" } --body--> FeedTarballExtractTask   (a day)
SecFetchTask { response_type: "stream" } --body--> ArchiveToFileTask        (an archive)
```

Three things that shape is load-bearing about:

- **The run sets `noAccumulation`**, and it is not a tuning knob. Without it
  `awaitStreamInputs` drains the edge to a value before the sink starts, and
  that value IS the ~1.5 GB day. The edge must also name `body` explicitly and
  have a single consumer, or the passthrough check declines and the drain comes
  back. `FeedTarballExtractTask.test.ts` parks the producer before its final
  chunk and requires the sink to have already written — it fails outright with
  the flag off, so the property cannot silently regress.
- **`byteIterableFromEvents` turns an in-stream `error` event into a throw**,
  never a clean end. On a clean end gunzip is handed a truncated archive, the
  walk loop finishes normally, and the day is marked done holding half its
  documents — silent, permanent loss. It is an async generator rather than a
  `ReadableStream` because that is where the runtimes diverge: an errored WHATWG
  stream wrapped through `Readable.fromWeb` does not reliably reject under Bun,
  and the truncated-archive case hung instead of failing.
- **`ArchiveToFileTask` opens its tmp file lazily, on the first byte.** That is
  what makes a `304 Not Modified` safe end to end: it carries no body, so no
  stream is created, so nothing is opened and the extracted tree the conditional
  request just certified as current is untouched. Opening up front would
  truncate it to zero before discovering there was nothing to write. The other
  reason a port can carry no stream — a `body` that arrived as a VALUE — is the
  opposite verdict and throws, since a materialized edge is the entire cost this
  replaced.

`Content-Length` verification is not reimplemented in sec: `FetchUrlTask`
asserts the advertised length at end of stream, which is the only evidence
available that a body ending without a socket error was complete. The
ETag/Last-Modified marker bookkeeping stays in `BootstrapDownloadTask` — that is
sec's own state, not the fetch's.

Routing these through `SecFetchTask` also puts them under `SecFetchJob`'s
per-attempt timeout, and that is why the timer measures **time without
progress** rather than total elapsed time. As a wall-clock cap it covered the
whole attempt, body included, so whether a fetch succeeded was a function of
file size and bandwidth rather than of the connection being alive: at the 60 s
default neither a multi-GB `submissions.zip` nor a ~1.5 GB daily Feed tarball
can finish, and the abort lands mid-body where the post-delivery retry ban
refuses to restart it — unrecoverable, not merely slow. A steady trickle now
rearms the timer on every delta; a body that goes silent still trips it, and a
fetch that stalls before its first byte keeps exactly the fixed window it always
had (nothing rearms without progress), so the fast-failure property the
per-document sweeps rely on is not traded away for the two bulk downloads.

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

# Recompute the derived identity columns from the name as filed before
# resolving, so a normalizer change takes effect without re-extracting
sec resolve --kind company --resolver-version 1.0.0 --all --renormalize

# Suggest aliases for filers EDGAR has carried under two spellings of one name
sec canonical suggest-aliases --kind company
sec canonical suggest-aliases --kind underwriter-family --format tsv > aliases.tsv

# Alias management (person; same flags for company)
sec canonical person alias "<from-name>" "<into-name>" --reason "merged duplicate"
sec canonical person alias-remove "<name>"
sec canonical person alias-list                # display names + ids
sec canonical person alias-list --orphans      # names whose target no longer exists
sec canonical person alias-list --format tsv   # export (names, which survive a re-key wipe)
sec canonical person alias-import <file.tsv>   # restore from that export

# Coverage — person | company | sponsor-family | underwriter-family
sec version coverage resolver person
sec version coverage resolver company
sec version coverage resolver sponsor-family

# Cleanup — drop-previous is person/company only; the family kinds error
# (no rebuild path — see the family-tier note further down)
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
and an optional confidence floor via `SEC_S1_CONFIDENCE_FLOOR`.

Extraction samples greedily: every call sends `temperature: 0`
(`SEC_EXTRACTION_TEMPERATURE`, empty value to send no temperature at all; a
malformed or out-of-`[0, 2]` value throws naming the variable rather than
coercing to `0`, which would read back as "greedy sampling is on" — the opposite
of what a typo like `0,5` was asking for).
Extraction is transcription — the answer is already in the filing — and unpinned
sampling made re-processing ONE filing yield 138/138/109 risk factors whose
contents differed in all three cases; the two 138-row runs disagreed on _which_
captions they found. On OpenAI's reasoning families the two knobs are coupled:
`gpt-5.6-luna` answers `temperature` alone with `400 Unsupported parameter`, but
accepts `{reasoning: {effort: "none"}, temperature: 0}`. The provider therefore
turns reasoning off for any request that pins a temperature
(`finalizeResponsesRequest`), so no caller has to know that. State an effort
explicitly with `SEC_OPENAI_REASONING_EFFORT` (`low`/`medium`/`high`) to
override the inference — the enum is per-model, so an unsupported value like
`minimal` on `gpt-5.6-luna` fails loudly rather than degrading. All extractors
share a general default model (`SecModelDefault` in `src/config/Constants.ts`);
set `SEC_MODEL_DEFAULT` to change every extractor at once, and a per-extractor
env var (e.g. `SEC_S1_MODEL`) to override just one. Each of these variables is a
CSV list. The reserved id `deterministic` is the sync table/prose walk for that
extractor. Position is attempt order (`deterministic,claude-haiku-4-5` walks
first; omit it and the walk does not run). The built-in `SEC_MODEL_DEFAULT`
stays a cloud id — to restore walk-then-model after this change, set
`SEC_S1_MODEL=deterministic,<current>` and, independently,
`SEC_S1_CLASSIFIER_MODEL` if the content classifier should walk too. `sec eval
extract --models deterministic` / `sec eval s1 --models deterministic` score the
walk in the same table as cloud ids (`$0`, no API key).

CLI startup registers these model ids (the default plus any set overrides, plus the local HFT default
`SecHftModelDefault`) into the global model repository via `registerSecModels`
(`src/config/registerModels.ts`). `secModelRecord` dispatches on id shape, and
the full list is `KNOWN_MODEL_ID_SHAPES` in that file — the string the
unknown-id error prints, so it cannot drift from the dispatch:

| id shape                                     | provider                |
| -------------------------------------------- | ----------------------- |
| `llama:…` / `node-llama:…` / `gguf:…`        | `LOCAL_LLAMACPP`        |
| `onnx:org/name`                              | `HF_TRANSFORMERS_ONNX`  |
| `hfi:[provider:]org/name`                    | `HF_INFERENCE`          |
| `open-router:[provider:]vendor/model`        | `OPENROUTER`            |
| `claude-*`                                   | `ANTHROPIC`             |
| `gpt-*` / `chatgpt-*` / `o1-*`/`o3-*`/`o4-*` | `OPENAI`                |
| `gemini-*`                                   | `GOOGLE_GEMINI`         |
| `grok-*`                                     | `XAI`                   |
| `deepseek-*`                                 | `DEEPSEEK`              |
| `deterministic`                              | sync walk (no provider) |

Every record explicitly declares the `json-mode` capability
`StructuredGenerationTask` gates on (the installed provider's
capability inference doesn't recognize newer ids like `claude-sonnet-5`,
`gpt-5.5`, `gemini-3.1-pro-preview`, `grok-4.5`, or `deepseek-v4-pro`).

A **bare `org/name` id routes nowhere** — every local/gateway shape needs its
prefix, so a HuggingFace ONNX repo is `onnx:onnx-community/…` and a
`deepseek-ai/…` repo is `onnx:deepseek-ai/…`. (There is consequently no
prefix-ordering rule between `deepseek-*` and `org/name` any more: the two
shapes no longer overlap.) The unknown-id error says so for any id containing a
`/`, naming the three prefixed forms of the id the caller passed. So
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

A `MODEL_RESOLUTION_ERROR` dead-letter (model/provider was unavailable) or a
`RATE_LIMITED` one (the provider throttled the call and the section spent its
whole wait-out budget without the window clearing) is retryable under the
**same** extractor version — `retry-dead-letters` recovers it once the
model/provider is registered, or once the quota window has moved on, with no
version bump required (`MODEL_ERROR_REASON_CODES` in
`ExtractionDeadLetterSchema.ts`).

`MIXED_CAPTION_SHAPE` is same-version retryable too, but **bounded**
(`NONDETERMINISTIC_REASON_CODES` / `NONDETERMINISTIC_RETRY_ATTEMPTS = 3`, same
file). It describes one generation's response, not a defect in the extractor, so
a version bump is the wrong ceremony — but unlike a provider outage a genuinely
ambiguous section never clears on its own, and an unbounded same-version retry
would leave an entry no operator can resolve while re-paying the AI cost of the
largest section in the filing on every sweep. After three recorded attempts it
falls back to the version gate. Every other reason code is version-gated from
the start (fix the extractor, bump the version, then retry).

The two are deliberately **not** the same code even though their retry semantics
are identical: `MODEL_RESOLUTION_ERROR` means the configured model id is not
registered, and its operator action is to add a key or register a provider;
`RATE_LIMITED` means wait, then retry. Merging them makes the worklist counts
unreadable during exactly the outage an operator would be triaging.

The vocabulary is `DEAD_LETTER_REASON_CODES` in
`ExtractionDeadLetterSchema.ts`: `SECTION_NOT_FOUND`, `MODEL_INVALID_OUTPUT`,
`MODEL_EMPTY`, `MODEL_RESOLUTION_ERROR`, `LOW_CONFIDENCE_ALL`,
`PRIMARY_DOC_UNRESOLVED`, `FETCH_ERROR`, `PARSE_ERROR`, `STORE_ERROR`,
`OVERSIZED_INPUT`, `UNVERIFIED_SOURCE_SPAN`, `SOURCE_SPAN_TOO_LONG`,
`MIXED_CAPTION_SHAPE`, `NONCE_MISMATCH`, `RATE_LIMITED`,
`CONVERTER_NO_STRUCTURE`. The stored column is a
plain string, so `DeadLetterInput.reason_code` is typed to that union — a code
written but never declared used to persist silently (which is how
`UNVERIFIED_SOURCE_SPAN` and `SOURCE_SPAN_TOO_LONG` were both written for some
time without appearing in the list an operator reads); adding one is now a
compile error until it is declared.

`MODEL_INVALID_OUTPUT` is **never an expected negative**. It is the section
runner's catch-all for any throw it could not classify — a provider 5xx, a
schema rejection, a failure inside `persist` — so it says nothing about what the
filing disclosed. `EXPECTED_NEGATIVE_REASON_CODES` (same file) is therefore
`MODEL_EMPTY` **only**, scoped to the `loi` / `redemption` detectors: those
extractors record a successful run row regardless, so treating a catch-all
failure as a confident negative left no extraction row, no pending entry, and
nothing for the forms sweep or the backfill anti-join to re-select.

`CONVERTER_NO_STRUCTURE` is the S-1 extractor's own diagnostic, recorded under
the section name `converter`: the HTML converter produced a document with no
usable structure, so the tree walk found nothing and the line-scan fallback stood
in (see the segmenter note below). It is deliberately NOT the filing-level `""`
key — `ProcessAccessionDocFormTask` resolves that one after a successful store,
which would clear the entry on the run that recorded it — and it is deliberately
recorded even though the fallback usually recovers the filing: eight
`SECTION_NOT_FOUND` entries are indistinguishable from a legitimately
incorporation-by-reference S-1, so without it "we could not read a 3.2 MB
prospectus" and "this filing has no such section" report identically.

#### Filing-level dead-letters (every form, not just the AI ones)

The per-section entries above are the AI extractors' story. `ProcessAccessionDocFormTask`
adds a **filing-level** entry (`section_name = ""`, rendered `(filing)` by
`sec extractor dead-letters`) for each of the four stages it can fail at, and in
every case records the failure, marks the extractor run failed, and returns
`{ success: false }` rather than throwing — one bad filing never aborts a sweep,
and the entry is recoverable through the same `retry-dead-letters` ceremony:

| stage                   | reason code              |
| ----------------------- | ------------------------ |
| no primary document     | `PRIMARY_DOC_UNRESOLVED` |
| body fetch threw        | `FETCH_ERROR`            |
| parse threw / was empty | `PARSE_ERROR`            |
| storage handler threw   | `STORE_ERROR`            |

This is what makes the structured-XML extractors (Form D, the Form C family,
1-A/1-K/1-Z, ownership 3/4/5, 144, CFPORTAL) recoverable: they have no sections,
so the filing-level key is the whole story for them. `STORE_ERROR` is
version-gated like `PARSE_ERROR` — the fix lives in the extractor's storage code.
A transient backend blip does not need the worklist at all: the failed run row
makes the ordinary forms sweep re-select the filing, and a clean run resolves the
entry automatically. Cooperative cancellation (Ctrl-C) is re-thrown from the
store stage rather than dead-lettered, so an interrupted sweep does not stamp
version-gated failures on filings it merely stopped mid-flight.

### Download-before-use harness

Local model weights must be on disk before generation, and providers differ on
when that happens: HuggingFace ONNX auto-fetches on first generation; node-llama-cpp
(GGUF) loads its `model_path` directly and never fetches at generation; cloud API
models have nothing to download but must still exist on the provider. `EnsureModelDownloadedTask`
(`src/task/model/EnsureModelDownloadedTask.ts`) is the single seam that normalizes this.
It takes a **model id** and figures out the provider from the id shape via
`secModelRecord` (no resolved `ModelConfig` handed in), then:

- owns and runs `ModelDownloadTask` for the local providers (memoized per model
  id so a per-section sweep pays the download once), skipping a bare-path GGUF
  (no `model_url` — the file is assumed on disk); and
- owns and runs `ModelInfoTask` for cloud API providers (`ANTHROPIC`, `OPENAI`,
  `GOOGLE_GEMINI`, `XAI`, `DEEPSEEK`, `HF_INFERENCE`, `OPENROUTER`) so a typo'd
  or retired model id fails before extraction starts — each provider's `model.info`
  run-fn hits the live API (retrieve/get, or list+exact match where retrieve
  does not exist; never a curated FALLBACK list).

The download / verify runs as an **owned** subtask (`context.own`), so it is
registered in the running task's graph and inherits its registry + abort signal.
Passing the **real** `IExecuteContext` (not a throwaway stub) is what surfaces
download progress — the download run-fn's `phase` events are forwarded to
`context.updateProgress`, which the `@workglow/cli` progress UI (`withCli`)
renders, so a multi-GB GGUF/ONNX fetch shows a live percentage instead of a silent
hang (and `context.signal` aborts it on Ctrl-C). `prefetchModel(modelId, context)`
is the best-effort wrapper the CLI-task boundaries call (own + run the task,
swallowing failures): the AI form processors (`processFormS1` / `processForm424` /
`processMergerProxy` / `processRedemption8K` / `processLoi8K`, via a `context`
threaded through `storageArgs`) prefetch once after resolving their model, and the
eval loops prefetch before their timed sections (so download time isn't charged to
a model's measured latency). `runStructured` keeps an `ensureModelDownloaded` call
as a per-section correctness safety-net — it downloads / verifies silently if a
model was never prefetched (e.g. a sub-extractor's distinct model), but the
progress-bearing fetch lives at the task boundary.

To make GGUF weights fetchable rather than pre-staged, a `gguf:` id may be a
**remote URI** — a node-llama-cpp HuggingFace URI (`gguf:hf:org/repo:Q4_K_M`) or
an `https://` URL — which `secModelRecord` turns into a `model_url` (download
source) plus a local `model_path` / `models_dir` under the GGUF models dir. A
plain `gguf:` path (`gguf:Model-Q4.gguf`, `gguf:/abs/Model.gguf`) stays a
load-directly local file, unchanged.

### AI SPAC content classifier (SIC-miscoded SPACs)

Deterministic SPAC classification keys off the SGML-header SIC (`6770` →
`is_spac`, `classifier_source = "sgml-header"`), but the header alone is no
longer sufficient: a **post-de-SPAC** registration statement carries a stale
6770 because the surviving operating company keeps the shell's CIK and EDGAR
keeps coding the filer for years. `Ionetix Corp / DE /` — filed as `JDEV
Acquisition Corp` — filed a 2026 S-1 under a `BLANK CHECKS [6770]` header
carrying 1,844 XBRL facts of real operating financials, and minting a known-SPAC
row for it gates the entire 8-K / merger-proxy / Form 25-15 tier onto a company
that already completed its combination. So a 6770 header is **downgraded**
(`classifier_source = "sgml-header-rejected"`) when the prospectus summary does
not read like a blank check, and the AI content classifier below is then its
second chance. The gate reads the SUMMARY rather than the whole document — a
de-SPAC prospectus recounts its own SPAC history at length, so the raw-HTML
heuristic passes exactly the filings this is meant to catch — and only a
**substantial** summary can demote (2k characters; the smallest in the committed
corpus is ~13.6k). Silence is evidence only where there was room to speak: a
summary stub says nothing about anything, and demoting on it would turn a
segmentation shortfall into a classification.

Two more limits keep the demotion from eating real blank checks. It **never
demotes a CIK that already has a `spac` row**: a CIK that once registered as a
blank check stays a SPAC CIK for good — the shell keeps its CIK through the
combination and renames, which is precisely what the row's three eras exist to
model — so a post-combination filing must attach to the vehicle it belongs to
rather than be judged afresh on prose that now describes an operating company.
The content gate is only for a CIK nothing knows about yet, where the question
is whether to MINT a row on the strength of a stale header. And it demotes only
on a summary carrying **zero** blank-check signals, not the two
`looksLikeBlankCheck` defaults to: the two callers ask the same question with
opposite error costs (a false negative in the AI pre-filter skips a model call;
here it deletes the `spac` row), and at 2 it demoted `Lucent, Inc.` — a shell
whose summary states outright that it is a blank check company, that phrase
being its only signal because a shell that size has no trust account, no founder
shares and no sponsor. Across the committed corpus all 20 labelled SPAC
summaries carry ≥2 signals and every non-SPAC filed under a 6770 header carries
zero. A SPAC filed under a miscoded or
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

The documented default set is cross-provider — `claude-haiku-4-5`,
`claude-sonnet-5`, `deepseek-v4-flash`, `gemini-3.6-flash` — so a full bare run
wants **three** keys: `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` and
`GEMINI_API_KEY`. A default whose key is absent is **skipped with a warning**
naming the ids and the missing variables, rather than sweeping into a table half
full of failed runs presented as if the models had been ranked and lost. An
explicit `--models` is never filtered: naming an id is a request to run it, and
a failed run is the honest answer.

```bash
sec eval extract                              # default: haiku, sonnet, deepseek-flash, gemini-flash
sec eval extract --models "claude-haiku-4-5,onnx:onnx-community/Qwen3-4B-Instruct-2507-ONNX"
sec eval extract --extractor management --format json

# Re-run just the fixture a model failed on (name as printed in the failures list)
sec eval extract --fixture s1-management-operating-company --models "claude-haiku-4-5"

# Print prompt instructions, templates, or full fixture/section prompts and exit
# without making model calls. Supported by eval extract, eval s1, and eval unit-terms.
sec eval extract --print-prompts instructions --extractor management

# Cross-provider head-to-head: Anthropic vs OpenAI vs Gemini vs xAI vs DeepSeek.
# Each id routes to its provider by shape (gpt-*→OpenAI, gemini-*→Gemini,
# grok-*→xAI, deepseek-*→DeepSeek); needs the matching *_API_KEY per provider
# used. An id a provider doesn't serve
# is recorded as a failed run, not a crash — verify ids against each provider's
# models endpoint (e.g. GET https://api.openai.com/v1/models, /v1/models on
# api.x.ai, .../v1beta/models on generativelanguage.googleapis.com,
# /models on api.deepseek.com).
sec eval extract --models "claude-opus-5,claude-sonnet-5,claude-haiku-4-5,\
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
(not yet enabled) 2x peak-hour pricing, which the table does not model. Adopting
it is a per-deployment env-var opt-in, never a change to the built-in default
(`DEFAULT_SEC_MODEL`, which stays on a schema-enforced Anthropic id): set
`SEC_MODEL_DEFAULT=deepseek-v4-flash` to switch every extractor at once, or
`SEC_S1_RISK_FACTORS_MODEL=deepseek-v4-flash` to switch only the chunked
risk-factors section that dominates per-filing cost.

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
`onnx:onnx-community/Qwen3-4B-Instruct-2507-ONNX` — the `onnx:` prefix is
required). Only **non-thinking** instruct models work for `json-mode` — a
thinking model wraps the JSON in reasoning.

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
  An extractor may declare `personNameFields` so credentials do not split
  identity ("Isaac Manke" aligns with "Isaac Manke, Ph.D."), and every harness
  passes it — `eval extract` and `eval s1` must score one extractor by one set
  of rules. It is restricted to **person-only** extractors (`management`,
  `executive-compensation`): `normalizePerson` is lossy on organization names in
  exactly the way that matters, reading a legal-form suffix as a credential, so
  `WAVE Equity Fund, L.P.` and `WAVE Equity Fund, LLC` both hash to
  `wave-equity-fund` and collapse into one row. `beneficial-ownership` — whose
  `name` is a person OR an entity, per its `owner_kind` — therefore declares
  none, and `fixtures.test.ts` fails any extractor that declares the flag while
  carrying an `owner_kind` / `entity_kind` discriminator. It names the field
  under `entityNameFields` instead, and the row's own `entityKindField` picks the
  parser per row.

  That discriminator is **key material the reference side must carry**, not an
  answer. `matchKey` namespaces a name by its row's kind, so a golden label or
  fixture row that omits `owner_kind` keys as raw text while every candidate row
  keys as `person:`/`company:` (the extractor's schema makes the field
  required) — the two sides then align on nothing and a perfect model scores
  0/0/0, with every owner reported as BOTH missing and hallucinated. Every
  committed `beneficial-ownership` row therefore carries it, `O()` takes it as a
  required argument (a default is how the two sides drift apart again), and two
  guards hold the line: `fixtures.test.ts` fails a fixture row missing it, and
  `goldenS1Labels.test.ts` requires `compareFields + entityKindField` on every
  golden row. It is **excluded from the defaulted field set** — `eval s1` passes
  an explicit `compareFields` that never names it while `eval extract` passes no
  `fields` at all, so scoring it would have the two harnesses measuring different
  questions. Belt-and-braces, alignment falls back to **exact normalized text**
  when the kind-aware keys miss: strictly stricter than either identity hash, so
  it recovers a one-sided or disagreeing kind without ever merging
  `WAVE Equity Fund, L.P.` with `WAVE Equity Fund, LLC`.

- **Cost** — the generation task exposes no token usage, so cost is **estimated**
  (`src/eval/modelPricing.ts`: ~4 chars/token × public per-M pricing; local models $0).
  Absolute dollars are approximate; the ranking is what matters.
- **Speed** — measured wall-clock latency per extraction, under whatever
  parallelism the sweep ran at. `sec eval s1` therefore labels the column
  `lat@<s1>x<section>x<model>`: a `1x5x4` figure is not comparable with a `1x1x1`
  one, and the published haiku-vs-sonnet numbers below were measured
  **serially**. Wall-clock includes time queued behind the sweep's own other
  extractions — a local model's especially, since one worker serves them all, so
  its latency reflects queue depth as much as model speed. Set all three
  `--concurrency-*` flags to 1 for figures comparable across runs.

  `sec eval s1` fans out on **three nested axes**, each with its own flag, and
  the extractions in flight is at most their product (default `1 x 5 x 4 = 20`):

  | flag                          | default | bounds                               |
  | ----------------------------- | ------- | ------------------------------------ |
  | `--concurrency-s1`            | 1       | filings extracted at once            |
  | `--concurrency-section`       | 5       | sections of one filing at once       |
  | `--concurrency-section-model` | 4       | candidate models scoring one section |

  That product is an **upper bound, not a measurement**. Each axis is separately
  capped by the work available to it — the filing count, the widest filing's
  section count, and the number of ids `--models` named — so a bare
  `sec eval s1` (whose default `--models` is a single id) reaches at most
  `1 x 5 x 1 = 5` in flight while the request reads `1 x 5 x 4 = 20`. The
  `lat@…` header and the footer therefore report the **effective** triple, since
  the column's only purpose is telling whether two latency figures were measured
  under the same load; the footer names the requested triple as well whenever
  the two differ, so a capped axis reads as a cap rather than an ignored flag.
  The section figure is a per-filing **maximum** ("at most N sections"), not a
  uniform width. `--format json` carries both `concurrency` (requested) and
  `effectiveConcurrency` (reached).

  There is deliberately **no per-provider awareness** — no grouping candidates by
  vendor, no per-provider limiter. The operator manages provider load with these
  flags, which is also why the model axis is a flag at all: it used to run at
  `candidates.length`, so `--models` with ten ids silently put 50 extractions in
  flight rather than the 20 the defaults describe. Naming a model is not a
  concurrency decision.

  Filings are grouped (`groupSectionsByFiling`) before the outer map, so the
  sweep finishes a filing before starting the next. That composes with the
  Ctrl-C behavior: an interrupted sweep still prints what completed — per-section
  results are checkpointed as they finish and the `skipped` list says how many of
  how many sections the table covers — and with grouping, what it leaves behind
  is whole filings rather than a scatter of partly-covered ones.

The `ok` column is `successful runs / total runs`, where total is
models × fixtures × `--runs` — **not** a retry count. `--extractor management`
has two fixtures, so a clean sweep of one model reads `2/2` and `1/2` means one
of the two fixtures failed (named underneath). Retries are a separate,
inner loop: `runStructured` passes `maxRetries: 1`, so
`StructuredGenerationTask` reports "after 2 attempt(s)" — the initial call plus
one schema-feedback retry. Every score in the row is averaged over ALL runs
including failures (a failure scores 0), so one perfect and one failed fixture
reads 50% across the board; `latency` is likewise a mean, not one call.

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

`sec eval s1` scores candidates over **real committed S-1 sections**. The
reference defaults to **`golden`** — the committed human-verified labels in
`goldenS1Labels.ts` — because a fixed yardstick is worth more than a strong one:
a model oracle caps every candidate at its own accuracy, costs a call per
section, and disagrees with ITSELF between runs, so the bar moves under you.
Golden labels are free, instant and stable.

Coverage is derived from `GOLDEN_S1_LABELS`, not fixed: every extractor with at
least one committed label is scored, and `defaultGoldenSweepExtractors()`
(`src/eval/defaultSweepExtractors.ts`) is what both the default `--extractors`
set and the `sec eval s1 --help` line read — so the current list is always one
`--help` away and this paragraph cannot silently go stale. As committed today
that is 11 extractors — `beneficial-ownership`, `executive-compensation`,
`management`, `offering-terms`, `related-party`, `spac-classification`,
`spac-profile`, `spac-sponsors`, `sponsor-promote`, `underwriters`,
`use-of-proceeds` — over 42 labelled filings. A golden run scores the sections
that carry a label and reports every other one as skipped rather than quietly
passing it.

A twelfth extractor, `risk-factors`, is labelled but flagged
`disabled` in `EVAL_EXTRACTORS` — "exclude from **default** sweeps", not "hide
from the labels index". `extractorsWithGoldenLabels()` stays the complete index
(the coverage guards in `goldenS1Labels.test.ts` read it to prove every
committed label is reachable); `defaultGoldenSweepExtractors()` is that index
minus the flagged ones, and both eval harnesses now derive their default set
through the same `participatesInDefaultSweeps` predicate rather than each
deciding for themselves. Naming it explicitly still runs it:
`sec eval s1 --extractors risk-factors`.
Pass `--reference <model-id>` (use the strongest available, currently
`claude-opus-5` — never the model you are evaluating) to fall back to an oracle
for the unlabelled extractors, accepting that its verdict is an opinion.
`realSections.ts` segments the HTML into management / beneficial-ownership /
related-party prose. The reference retries a few times per section (strong models
intermittently emit a nested array as a JSON _string_ the strict schema rejects);
a section the reference still fails is dropped from scoring.

**Golden truth (`--reference golden`).** A live reference model is not ground
truth — even the strongest model drops or invents the odd role, capping
achievable agreement and penalizing a correct candidate. `--reference golden`
scores candidates against **committed labels** (`src/eval/goldenS1Labels.ts`)
instead of a model run — no reference API call, `$0`, deterministic. Only sections
with a golden entry are scored (the rest are reported as skipped);
the committed set is roughly 400 labelled (filing, section) pairs across the 12
labelled extractors — densest on `risk-factors`, `spac-classification` and
`use-of-proceeds` (42 filings each), thinnest on `spac-sponsors` (2). A default
sweep scores 11 of those 12: `risk-factors`' 42 labels are still committed and
still guarded, but only an explicit `--extractors risk-factors` pays for them.
Titles are stored in canonical (`normalizeManagementTitles`) form and unit-tested
to stay canonical. Use golden truth to tell which model is actually _correct_
(not merely reference-like); use a model reference to sweep sections that aren't
hand-labeled.

The reverse gap is reported too: a committed label whose **fixture** never
arrives is listed in `skipped` rather than silently dropped. That is not
hypothetical — embarc-data vendors its own copy of the S-1 corpus
(`SEC_S1_MOCK_DIR`, defaulted in its `eval` command), and when that copy drifted
behind sec's the labelled filing produced no section at all, so the sweep scored
fewer filings than the labels covered and still printed a clean table. Re-copy
the corpus into the vendoring package when you add a fixture.

**A bare `sec eval s1` is not a cheap command.** Under the default golden
reference the default extractor set is every labelled extractor not flagged out
of default sweeps, so one candidate model sweeps roughly 350 sections over prose
running from a few thousand chars to ~57k. Adding `--extractors risk-factors`
adds 42 more sections and materially more than 42 calls, since that extractor
chunks a section running to ~246k chars into several — which is why it is
excluded by default. Budget it, or narrow it: `--extractors` picks the
sections, `--cik` picks the filer, and the two compose. Only the candidate side
costs money under `--reference golden` (no oracle call); a model reference
roughly doubles the calls and pays the reference model's rate on top.

`--cik <csv>` narrows a sweep to one filer (leading zeros optional), which is how
you check a newly added fixture or label without paying for the whole corpus. A
CIK matching no fixture is an error listing the available ones — an empty sweep
would otherwise read as a pass.

```bash
sec eval s1 --cik 2147219 --models "deepseek-v4-flash"
```

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

> **The same shape, found again — zero-holding rows.** An ownership table lists
> officers and directors who hold nothing, printing `-` in both the share and
> percentage columns; the disclosure IS that they hold none. The prompt said to
> use null "for figures shown as '\*', '—', or blank" but never said the ROW
> still had to be emitted, so `deepseek-v4-flash` dropped four such owners from
> the TEN Holdings table and scored 95% recall for it. The golden labels were
> right and the model was wrong — the opposite of the Haldeman title case found
> in the same run, where the label was wrong and the model right. Both were only
> resolvable by re-reading the filing, which is the actual discipline: a
> disagreement says one of the two is wrong, not which. With the row rule pinned
> in the prompt, recall went to 100% and the fix generalized to a filing the
> model had never seen (Rainier, four all-dash rows, 100%).

```bash
# Default: human-verified truth (deterministic, no reference call, no cost)
sec eval s1 --models "deepseek-v4-flash"

# Model oracle for sections golden labels do not cover
sec eval s1 --reference claude-opus-5 --models "claude-haiku-4-5" \
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
sec sync facts --retry-failed   # also re-fetch CIKs whose last facts processing failed
```

A curated sample of real S-1 prospectus HTML (incl. ≥3 SPACs, SIC 6770) is
committed under `src/sec/html/mock_data/s1/` (see its `SOURCES.md`) and exercised
by `parseEdgarHtml.golden.test.ts`. To refresh / grow the sample on demand into a
gitignored cache:

```bash
sec fetch s1-fixtures                 # ~10 real S-1s (>= 3 SPACs) -> mock_data/s1/.cache/
sec fetch s1-fixtures -c 20 --min-spac 5
```

#### Golden fixture provenance

The **committed** corpus under `src/sec/html/mock_data/{s1,424}/` stays committed
— the golden tests are hermetic and must not depend on EDGAR being reachable
(the quarterly `form.idx` endpoint already 403s from cloud containers). What is
pinned instead is its provenance: `src/task/fixtures/goldenFixtureManifest.ts`
records, per fixture, the EDGAR primary-document filename, the SHA-256 of the
bytes EDGAR serves, the capture `transform`, and the SHA-256 of the committed
file.

```bash
sec fetch golden-fixtures --verify   # re-fetch from EDGAR, compare, write nothing (non-zero exit on mismatch)
sec fetch golden-fixtures [--force]  # reproduce the corpus from the manifest
```

Verify reports `remote-changed` and `local-modified` separately because they
demand opposite responses: the first means re-pin the manifest, the second means
a golden fixture was edited and the tests it backs are measuring an artifact. A
digest mismatch is never written to disk, so a truncated response or an EDGAR
error page cannot silently replace a fixture. Most entries are `verbatim` (which
for several of these files includes the dissemination SGML wrapper EDGAR serves);
the one `strip-sgml-wrapper` entry stores the inner body, matching what
`Form_424.parse()` hands the converter. The synthetic `.txt` submissions are
deliberately absent from the manifest — they exist nowhere on EDGAR.
`goldenFixtures.test.ts` re-hashes the committed files against the manifest with
no network, so an in-place edit fails in CI.

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

#### Executive compensation (Summary Compensation Table)

The Item 402 **Summary Compensation Table** lands in `executive_compensation`
(`src/storage/executive-compensation/`), one row per named executive officer
**per fiscal year**, keyed `(extractor_id, accession_number, row_index)` and
cleared before re-insert like the ownership/related-party tiers. The money
columns are the union of Item 402(c) and the scaled Item 402(n) most S-1
registrants report under (which omits the non-equity-incentive and
pension/NQDC columns and shows two fiscal years, not three) — every one is
nullable, so both regimes map onto the same row without a discriminator.

The officer is linked by `observation_id` — minted **once per officer**, so an
officer shown for two fiscal years is two rows against one mention, which is why
the row key and the FK are separate columns. The claim carries **no
`role_scope`**: the
compensation table names only the named executive officers — a strict subset of
the management roster — so it records observation titles but mints no
`person_role` tenure and can never participate in the `s1:management` roster
closure. `principal_position` stays on the compensation row because it is the
position as stated for that fiscal year.

Extraction is an AI pass, not a deterministic table parse, even though the
column set is prescribed by regulation. In real EDGAR markup the caption row is
`<td>` rather than `<th>` (so `TableExtractor` reports zero header rows),
captions are colspan-stretched across the spacer columns carrying the `$` sign
and footnote markers, and the officer's name, position and per-year figures are
distributed across grid rows differently by every filer agent. The stable part
is the caption vocabulary, not the grid — which is exactly what the
`hasSummaryCompensationTable` gate (`s1/compensationHeuristic.ts`) keys on.

That gate runs first and is what keeps the section cheap: a blank-check
company's compensation section is one sentence stating that no officer has been
paid, and most registration statements have no compensation section at all.
**Neither is a failure**, so neither costs an AI call and **both resolve rather
than dead-letter** — explicitly: "no section matched" (nothing in `byName` under
`Executive Compensation`) and "section matched but carries no Summary
Compensation Table" take the same `markResolved` path, which also clears an
entry a previous version left, so a correctly-behaving filing never lingers on
the retry worklist. Recording the no-section case would put an
`Executive Compensation` entry on the worklist for the majority of all S-1s,
permanently (only a version bump clears one), burying every genuinely
triageable entry; the heading-coverage question it would answer is a counting
question and belongs on a counting surface. Real failures are still recorded
under the `S-1` extractor id with section name `Executive Compensation`
(`sec extractor dead-letters S-1`).

The stub-column **position line** is folded onto the officer named above it
(that row commonly carries a different fiscal year's figures), but only when it
carries something: a position row with no fiscal year and no money column is
just the label, and folding it unconditionally emitted a second row per officer
— same `observation_id`, null year, all-null money — in a table whose contract
is one row per officer per fiscal year.

The `executive-compensation` entry in `EVAL_EXTRACTORS` ranks the prompt through
`sec eval extract`, against two golden fixtures: a two-year, three-officer table
in the spacer-column layout real markup converts to (the name and position lines
carrying different fiscal years — the layout a model most often misreads by
emitting the position line as a second person), and a combined
"Executive and Director Compensation" section whose separate Item 402(r)
director table must **not** be extracted.

```bash
sec eval extract --extractor executive-compensation
```

Not yet wired into the priced-424 path, which repeats the same table.

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
sec canonical underwriter-family alias-list [--orphans]        # display names + ids
sec canonical underwriter-family alias-list --format tsv       # export
sec canonical underwriter-family alias-import <file.tsv>       # restore from that export

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

#### Lock-ups

A prospectus's lock-up disclosure yields one `spac_lockup_terms` row per
restricted class, keyed `(extractor_id, accession_number, lockup_index)` —
several per filing, because a filing states several: the underwriters' lock-up
on the whole float, the sponsor's on its founder shares, often a longer one on
the private-placement warrants. They have different durations, different anchors
and different price tests, and folding them into one row would state a release
date that applies to none of them.

The row is what the filing SAYS, never a date. A duration (`duration_days`) is
meaningless without its `anchor_event` — a founder lock-up runs from the CLOSING
of the combination, an underwriter lock-up from the pricing of the offering —
and the price test is a condition on a series this extractor does not have:
`price_trigger` at or above on `trigger_days_at_or_above` sessions within any
`trigger_window_days`, no earlier than `trigger_start_delay_days` after the
anchor. Evaluating that against real prices is a separate step downstream, which
is what keeps this extractor from ever emitting a computed-looking release date
it did not compute.

Two things the prompt has to say, and does:

- **A duration and a price trigger are ALTERNATIVES on one lock-up, not two
  lock-ups.** "One year, or earlier if the shares close at or above $12.00 for
  20 trading days within any 30-trading-day period" is one row carrying both. A
  model that splits it invents a restriction the filing does not impose.
- **Do not assume a customary term the filing omits.** The customary founder
  lock-up is so standard that a model will supply it for a prospectus that
  states only an underwriter lock-up, and the `lockup-underwriter-only-no-price-test`
  fixture exists to measure exactly that.

`holder_class` is constrained by the schema rather than by the prompt, and
`persist` filters against the same vocabulary: a lock-up filed under a class
nothing downstream knows is a restriction nobody will ever evaluate.

The section text is the Item 12 `Shares Eligible for Future Sale` block, falling
back to `Underwriting`. Both are needed, on measurement: of the 42 committed S-1
fixtures, 14 carry the Item 12 heading and 32 disclose a lock-up somewhere — so
the dedicated heading is worth reading first and cannot be the only way in.
Unlike `sponsor-promote` the section is never skipped for a non-SPAC filing,
since every registrant locks somebody up.

Adding the section is a **minor bump** on the S-1 extractor — previously
processed filings have no lock-up rows until they are re-run:

```bash
sec version start-dev extractor S-1 --minor
sec version promote extractor S-1
sec extractor backfill S-1 --force
sec eval extract --extractor lockups     # rank the prompt
```

#### Risk factors (Item 105 list)

The prospectus risk-factor section yields one `risk_factor` row per disclosed
risk, keyed `(extractor_id, accession_number, risk_index)` in document order:
the filer's **caption** verbatim (the bolded lead-in sentence that introduces
each risk) plus the **category heading** it sits under, as printed. The
multi-paragraph body under each caption is deliberately not stored — the caption
is the enumerable unit of the disclosure and the filing stays the body of
record — and neither field is mapped to a taxonomy, so the rows stay faithful to
the filing and any classification can be derived on top later. `verifyRow`
checks the **headline as well as** the `source_span` against the section text: a
paraphrased or invented caption is worthless even when the span it cites
verifies, so it is dropped (and, when every row is, dead-lettered
`UNVERIFIED_SOURCE_SPAN`). A category heading returned as if it were a risk is
caught by the same "enforce it, don't trust the prompt" guard the ownership
subtotal gets — a heading is verbatim section text, so nothing downstream would
otherwise stop it becoming a row that reads like a disclosed risk.

One rule does that work, and it is decided **after** the whole section has been
read, not chunk by chunk. `chunkRiskFactorText` reports the heading line it
prepended to each chunk (`RiskFactorChunk.carriedHeading`), and a row whose
caption is exactly that line is **remembered as a candidate echo** — it removes
the artifact chunking creates (a ~7-chunk section hands the model ~6 headings
and invites it to echo them back as rows) but it is not yet dropped. An echo
that is _reworded_ rather than copied is not this rule's problem: it fails
`verifyRow` like any other paraphrase and lands on the existing
`<section>-partial` / `UNVERIFIED_SOURCE_SPAN` triage entry.

Dropping the echo where it is found loses real captions, because de-duplication
runs first: a caption any earlier chunk already emitted is dropped as a
duplicate, so the echo branch is reachable **only** for a caption no chunk
emitted on its own — precisely the row whose sole appearance in the whole sweep
is that echo. On a filing whose section IS an Item 105(b) summary list, every
bullet is heading-shaped and the carried line is itself one of the filer's
bullets, so the drop deletes a disclosed risk and marks the section resolved.

The evidence that separates "line this code inserted" from "bullet the filer
printed" is the shape of the **rest** of the section, which only exists once
every chunk has answered. So the verdict is taken there, over the response's
shape **as a whole** rather than row by row — the shape heuristic cannot tell a
category heading from a summary bullet in isolation. Computed over the rows
**minus** the candidate echoes, so a dropped echo can never mask a mix:

- **all heading-like** — the section reads as a summary list, its "headings" ARE
  its captions, so the echoes are kept and nothing is dropped;
- **none heading-like** — an ordinary sentence-caption list, so an echo is the
  heading this code prepended and is dropped;
- **mixed** — unanswerable, and dead-letters `MIXED_CAPTION_SHAPE` (via
  `MixedRiskCaptionShapeError`) rather than persisting a subset.

"Heading-like" is `isRiskCategoryHeading`, and it is **two** conditions, not
one: the line does not end in sentence punctuation **and** it mentions risk
(`\brisks?\b`). Both halves are load-bearing, and the risk-word half is what
keeps the mixed-shape rule from firing on real filings — do not relax it to a
punctuation-only test. Measured over the committed golden labels: 52 captions
carry no terminal punctuation, and **zero** of them contain the word "risk";
all 52 sit in 14 filings, every one of which also prints ordinary punctuated
captions. Under a punctuation-only predicate `0 < headingLike < body.length`
would therefore hold for all 14, throwing `MIXED_CAPTION_SHAPE` and permanently
version-gating the **1,411** hand-verified captions those filings carry between
them.

The same clause bounds the `keepEchoes` remedy: keeping the echoes requires
**every** extracted row to be heading-like, hence to mention risk — which none
of the committed bare captions does. On today's corpus that branch is therefore
unreachable and the echo is dropped exactly as before. It is a guard against a
filing whose summary bullets happen to be phrased as "Risks relating to …", not
a fix already exercised by the committed fixtures.

The remaining dropped echo is at least **attributable**. `extractRiskFactors`
reports the dropped headlines verbatim to its caller, and the S-1 processor
records them as a sibling `risk-factors-echo-dropped` dead-letter carrying the
accession and the removed text — reconciled (resolved) on a run that drops
nothing, mirroring the `<section>-partial` entry. A `console.warn` naming a
count is what made the earlier ratio-gated variant unreviewable; this branch
still deletes rows a model returned and still lets the section resolve as
complete, so it must leave a record an operator can read.

Filers are inconsistent about terminal punctuation, so one summary bullet ending
in a period was enough to make an all-or-nothing filter keep that single row and
silently drop the other 29 — a partial disclosure recorded as complete, exactly
what the chunked-section contract exists to prevent. A ratio-gated variant (drop
the heading-shaped rows while they are a small enough minority) was tried and
removed: it reproduced that failure in the other direction — four bare bullets
out of twenty deleted from a section that then resolved clean. The price of the
strict rule is that one stray heading fails the whole section; it fails visibly,
with every caption recoverable by re-running the filing. Because a mixed shape
is a property of one generation rather than of the section, `sectionRunner`
re-asks the model up to `MIXED_SHAPE_REASK_ATTEMPTS` (2) times before recording
it — its own budget, deliberately smaller than the `VERIFICATION_ATTEMPTS` (3)
a failed span verification gets, because the two re-asks bet on different
things. A malformed citation varies run to run; a mixed shape re-asks a
byte-identical prompt under greedy decoding (`SEC_EXTRACTION_TEMPERATURE`
defaults to `0`, the nonce is off by default, the call is not cacheable), where
only provider-side batching can change the answer — and each ask re-enumerates
the largest section in the filing. Worst case for a 7-chunk section is 42 model
calls rather than 63. The recorded entry then stays retry-eligible under the
**same** extractor version for `NONDETERMINISTIC_RETRY_ATTEMPTS` (3) attempts —
after which it falls back to the ordinary version gate rather than re-paying the
AI cost of a genuinely ambiguous section on every sweep forever.

That budget is counted per failure, not per section. `attempts` on a dead-letter
row counts **consecutive** failures of the current
`(reason_code, failed_extractor_version)` pair and restarts at 1 when either
changes (and is zeroed by `markResolved`). The row is keyed by section, so a
lifetime counter would be shared across every code the section ever hit: a
section that failed `UNVERIFIED_SOURCE_SPAN` three times under an older version
would arrive at its first-ever `MIXED_CAPTION_SHAPE` already over budget and get
no same-version retry at all.

Risk factors is by far the largest section in an S-1 — 3k to 246k chars across
the committed fixtures, against 40–57k for the sections that already dominate
wall-clock — and the only one enumerating dozens of rows, which is what forces
chunking: one response cannot hold ~90 captions without overrunning the
extractors' output-token ceiling and truncating the JSON. `chunkRiskFactorText`
(`s1/riskFactorChunks.ts`) splits the section on paragraph boundaries into
40k-char chunks (~15–25 captions each, at the ~1.5–2.8k chars per risk the
fixtures measure) and prefixes every chunk after the first with the last category heading seen
before it — a verbatim line from the section, so spans still verify — reporting
that line back on the chunk so the extractor can identify its echoes by exact
match. `extractRiskFactors` runs one call per chunk, concatenating in document
order and de-duplicating on the caption. A
chunk that fails propagates and fails the whole section: persisting the captions
that happened to arrive first would record a silently partial list as if it were
the filing's complete disclosure. A section over 400k chars is a segmentation
failure (the prospectus body collapsed under one heading), not a real
disclosure, and dead-letters `OVERSIZED_INPUT` instead of fanning out into dozens
of calls — mirroring the redemption/LOI 8-K input caps.

#### Segmentation: swallowed sections and structureless documents

`DocumentTreeSegmenter` runs two passes. The first keeps, per target, the
occurrence with the most body text; the second truncates each chosen section
where it has **swallowed another chosen section's body**. A converter that
mis-levels a heading — `RISK FACTORS` in all caps at the top level, every
following sentence-case heading nested beneath it — makes that section's subtree
the rest of the prospectus: committed fixtures rendered "prospectus summaries" of
966k and 1,008k characters, and one filing's risk factors reached 586k and blew
past `MAX_RISK_FACTORS_CHARS` so the disclosure was never extracted at all.

The stop condition is narrow in two ways, and both are load-bearing. The nested
node must be another target's **chosen** body — a summary also contains a
management paragraph and an offering blurb, but those lose to the filing's real
sections and so stop nothing — and the containment must not be one prospectuses
really have (`LEGITIMATE_CONTAINMENTS`: summary ⊃ offering, summary ⊃ sponsor,
management ⊃ Item 402 compensation). A summary's own Item 105(b) risk list is
deliberately absent from that list: the segmenter accepts it as a Risk Factors
heading variant, so allowing it let three fixtures keep summaries carrying the
entire risk section verbatim.

Targets a filer bolds rather than heads are recovered from inside whichever
resolved section carries them, by `findNestedSection` — which scans the
container's rendered lines with the same heading patterns. Item 402 compensation
sits inside `Management` that way, and so does the ownership table (`TCG Growth
Opportunities Corp.`, where `Principal stockholders` follows the roster with no
heading of its own). It fires only when the tree walk found no section for the
target, so a filing with a real heading is untouched, and the **tightest**
enclosing body is tried first — section bodies overlap only where
`LEGITIMATE_CONTAINMENTS` says they may, and there the inner one bounds the slice
to the block that really encloses the line.

The rule is general with **one container excluded**: `RESTATING_CONTAINERS` —
today just `Prospectus Summary`. A summary's job is to restate the whole
prospectus by name, so every bolded label in it opens a slice for a section the
filing may not disclose at all. That is the entire measured cost of
generalizing: 6 wrong sections across the 42 committed fixtures, and **all 6**
come out of a summary (a 208k `The Sponsor` carved from a 217k summary, a 136k
`Management` for a filing whose roster is documented as bolded paragraphs with
no section at all). Excluding it leaves **zero** additions on the corpus, so the
generalization costs nothing and covers pairs nobody enumerated — on a real
filing outside the corpus (`Harvard Ave Acquistion Corp`, CIK 2042460) it
recovers a genuine 20k `The Sponsor` block from inside `Management`, a pair no
hand-written list predicted.

A real block inside a restating container is still reachable, by naming it in
`NESTED_SECTION_FALLBACKS`. There is exactly one: the offering table inside the
summary, which `LEGITIMATE_CONTAINMENTS` already expects to be there and which
`Mammon Omicron Acquisition Corp` bolds rather than heads, hiding 90k characters
of unit terms. Declared pairs are consulted **after** the general containers — a
real body section donating a target is the better claim.

**A slice-size guard was measured as the alternative and does not separate
them.** Five of the six summary slices run 68-96% of their container, but the
trusted compensation-inside-`Management` recovery runs 7-81% across 18 committed
fixtures, 14 of them above 68% — the bands sit on top of each other, and the
sixth summary slice is 14%, below all of them. Which section is donating
separates the good recoveries from the bad; how much of it does not.

Guessing the remaining pairs from **document order** does not work either: the
container is the nearest _resolved_ predecessor, not the immediate one. Ranking
each section's observed predecessor across the corpus predicts the compensation
and offering pairs correctly and gets the ownership one wrong — it names
`Executive Compensation`, which is the truth about a headed filing and not about
`TCG`, where that section is itself unheaded so the container moves up to
`Management`. The pair you cannot enumerate is exactly the one the general rule
covers for free.

When the tree walk resolves **fewer than two** targets on a document rendering at
least 50k characters, a **line-scan fallback** takes over: the rendered text is
scanned with the same heading patterns and each hit sliced to the next hit of a
_different_ target (a typeset prospectus repeats its section name as a page
header, which is furniture rather than a boundary). Bridgetown Holdings' 3.2 MB
prospectus is typeset inside 295 tables, so the converter emits 4 heading nodes
and the filing extracted **nothing**; it now recovers all ten target sections.
Both thresholds are deliberately tight — a line scan has no structural evidence
and cannot tell a table-of-contents entry from the heading it points at, and "the
converter produced no structure" is only a claim you can make about a document
big enough to have some. The filing is still recorded (`CONVERTER_NO_STRUCTURE`
above).

The segmenter's `Risk Factors` section also accepts the filer's own Item 105(b)
"Summary of Risk Factors" bullet list as a heading variant: it enumerates the
same captions in compressed form, and since the segmenter keeps the longest body
per section name, a filing carrying both extracts from the full section while
one carrying only the summary degrades to it rather than to nothing.

Configure the model via `SEC_S1_RISK_FACTORS_MODEL` (default `SecModelDefault`)
and an optional floor via `SEC_S1_RISK_FACTORS_CONFIDENCE_FLOOR` (falls back to
`SEC_S1_CONFIDENCE_FLOOR`). It gets its own knob because the chunked section
dominates per-filing extraction cost — pointing just this section at a cheaper
model is the reason to separate it. The `risk-factors` entry in
`EVAL_EXTRACTORS` (with a golden two-category fixture) ranks the prompt, and
`sec eval s1 --extractors risk-factors` sweeps the real committed sections.

That entry is flagged **`disabled: true`**, so `risk-factors` is **excluded from
both harnesses' default sweeps** — its 42 golden labels are still committed and
still guarded, but a chunked ~246k-char section run over the whole corpus is not
something a bare `sec eval extract` or `sec eval s1` should charge you for.
Naming it runs it, in either harness.

Production extraction is parked too (`EXTRACT_S1_RISK_FACTORS` in
`Form_S_1.storage.ts`). `sec spac process` / `sec sync spacs` skip the AI
call, leave any previously extracted rows in place, and do not dead-letter the
section. Flip the constant (or pass `extractRiskFactors: true` in tests) to
turn it back on; already-processed S-1s then need `sec extractor backfill S-1
--force`.

```bash
sec eval extract --extractor risk-factors        # explicit: runs despite the flag
sec eval s1 --extractors risk-factors            # explicit: runs despite the flag
sec extractor dead-letters S-1                   # includes the risk-factors section
```

Scoped to the S-1/F-1/DRS pipeline: the 424 processor shares the segmenter but
does not re-extract risk factors (a priced prospectus restates the registration
statement's risks), and no CLI query renders the table yet — same as the other
AI-extracted prospectus tables (`use_of_proceeds`, `offering_terms`).

The family-tier resolver kinds (`sponsor-family`, `underwriter-family`) support the
`coverage` ceremony, scoped to each tier's own version-scoped tables:

| kind                 | canonical                      | membership                      | per-filing link     |
| -------------------- | ------------------------------ | ------------------------------- | ------------------- |
| `sponsor-family`     | `canonical_sponsor_family`     | `sponsor_family_membership`     | `spac_sponsor_link` |
| `underwriter-family` | `canonical_underwriter_family` | `underwriter_family_membership` | `underwriter_link`  |

There is no observation -> identity-link table here: the per-filing **link row is**
the family-tier fact, keyed `(accession_number, extractor_id, observation_index)`
with `resolver_version` as a plain column. So exactly one row exists per fact,
carrying whichever version last wrote it, and **coverage** is the share of link
rows already attributed at the target version (`1.0` = every recorded family fact
re-resolved).

```bash
sec version coverage resolver sponsor-family
sec version coverage resolver underwriter-family
```

> **`drop-previous` is deliberately NOT supported for the family kinds** and still
> errors. On the person/company tier a purge is safe because identity links are
> _derived_: the observation rows survive it, so `sec resolve` rebuilds every link
> it removed. The family tier has no such backstop — the link row **is** the
> attribution, not a projection of something that outlives it — and batch
> `sec resolve` refuses family kinds, so nothing can rebuild what a purge deletes.
> Recovery would mean re-extracting every affected S-1/424 and re-paying the AI
> cost for all of them. The ceremony is symmetric in shape across the four kinds
> but not in consequence, and the asymmetry is invisible at the call site, so the
> destructive half stays unregistered until a family `resolve` exists to restore
> the rebuild invariant the other kinds rely on.

> Batch `sec resolve` still refuses any kind outside its `person|company`
> allow-list, but the reason it **had** to has been removed. The family key used to
> come from the **common** name the AI extractor emitted, which never reached the
> observation row, so a batch pass had nothing faithful to re-partition from.
> `normalizeFamilyName` now derives it from the **legal** name via
> `companyFamilyName` — a value every observation already carries — so a
> re-partition is a re-computation. Wiring the family-tier `resolve` (and the
> `drop-previous` it gates) is what remains.

#### Family keys: `companyFamilyName`

`companyFamilyName` (`src/storage/company/CompanyFamilyName.ts`) answers "are
these the same house", where `normalizeCompany` answers "are these the same
legal entity". It strips the trailing legal form, series marker (roman numeral
or year), parenthetical jurisdiction, EDGAR's own state-of-incorporation marker
(`/DE`, `/CI`, `/Cayman`), `Entities affiliated with` bloc prefix,
and a conjunction stranded by an `& Co.` — so `Churchill Sponsor XIII LLC` and
`Churchill Sponsor XIV LLC` are one family, and `Morgan Stanley` needs no alias
to meet `Morgan Stanley & Co.`

It deliberately does **not** strip business-line words. Dropping `Capital`,
`Ventures`, `Partners`, `Group` reads as harmless boilerplate and is not: those
words routinely separate two real houses, and `Acme Capital` / `Acme Ventures`
can be unrelated firms. The asymmetry decides it — an **over**-merge silently
attributes one house's deals to another and leaves no trace, while an
**under**-merge is visible as two families and costs one alias:

```bash
sec canonical underwriter-family alias "Chardan Capital Markets" "Chardan"
```

The legal form always goes. The **series marker** goes too — wherever it sits in
the name, not only at the end — except when dropping it would leave a single
generic vehicle word standing as the whole house name. `Fund II`, `Partners III`, `Ventures 2021` name no house at all, and
the numeral is the only distinguishing token they have, so collapsing them to
`fund` / `partners` / `ventures` merges every unrelated vehicle that shares the
generic word. Those keep their numeral (`fund-ii` ≠ `fund-iii`); everything that
still carries a house token after the strip does not
(`Churchill Sponsor XIII LLC` → `churchill-sponsor`,
`WAVE Equity Fund II, L.P.` → `wave-equity-fund`, `Curnes Fund 2001` →
`curnes-fund`). `GENERIC_VEHICLE_WORDS` is the vocabulary that answers "would
the surviving name still name a house" — a **floor, never a strip list**: no
word in it is ever dropped.

A marker in the **middle** of the name is stripped for the same reason it is at
the end — sponsors serialize a vehicle wherever the name reads best, and
`Southern Cross Acquisition I Sponsor Corp.` is the same house as its `II`. Both
of those, plus `Osprey Acquisition III, Sponsor LLC` and
`CGC III Sponsor DirectorCo LLC`, are real names in the committed golden labels
that a tail-only strip split into one family each.

Mid-name the rule is **stricter**, because position is no longer evidence. It
takes only well-formed roman numerals, never a bare number: `civil`, `dim`,
`mild` and `vivid` are all runs of `ivxlcdm` that the tail test would accept,
and `Route 66 Ventures` would lose its `66`. The first and last tokens are also
off limits — a leading numeral is the house's own name (`V Capital`), and the
last position already answered to the tail rule and its generic-vehicle floor,
so `Fund III` is not stripped by the back door.

Two more shapes the rule is measured against, both from real names in the
committed golden labels: stripping is **token-exact**, so `DirectorCo` is not
gutted by the `co` it ends in (nor `Cambridge Quantum` by `ua`); and it never
empties a name, so a name of nothing but droppable tokens (`III LLC`) is kept
whole rather than colliding with every other such name.
`Citigroup Global Markets Inc.` does **not** unify with `Citigroup`, a known gap:
stripping `Global` would fix it and corrupt `Fundamental Global Inc.`, which is
the worse error.

> ⚠️ Changing this function **re-keys the family tier**. Family keys are derived
> from the legal name every observation carries, so they are rebuildable in
> principle — but no batch family `resolve` exists yet, so in practice a re-key
> means re-extracting the affected S-1/424 filings.

> ⚠️ It is **not** an identity key. It throws away exactly what separates two
> vehicles of one sponsor, so using it to de-duplicate entities merges every SPV
> a sponsor ever formed. `CompanyFamilyName.test.ts` pins the contract: two funds
> of one family are ONE family and TWO companies.

#### Endings are matched as literals, not as patterns

`COMPANY_ENDINGS_TO_STRIP` holds word-shaped legal forms (`INC`, `CORP`, …) and
is escaped before it reaches a `RegExp`; phrase and placeholder suffixes live in
`LITERAL_SUFFIXES_TO_STRIP` and are matched by text compare. Keeping the two
apart — and both apart from `CANONICAL_ENDINGS`, which really is regex source —
is what stops a literal being read as a pattern. It was not: the placeholder
`[related person is an entity]` was interpolated into
`new RegExp("\\b" + ending + "\\b$")`, where its brackets are a **character
class**, so any name ending in a single-letter word drawn from
`{r,e,l,a,t,d,p,s,o,n,i,y}` had that word deleted. `Churchill Capital Corp I`
normalized to `Churchill Capital`; 44 of the 816 SIC-6770 registrants lost their
series marker; and `Reinvent Technology Partners` (CIK 1819848, now Joby) and
`Reinvent Technology Partners Y` (CIK 1828108, now Hippo) — two distinct
companies — collided on one canonical identity. The same list backs
`hasCompanyEnding`, the **person-vs-company discriminator** on Forms D / C /
1-A / 1-Z / 3 / 4 / 5 / 144, which read `Klein Michael S` as a company; and the
class contained a literal space, so `hasCompanyAnywhere` returned true for every
multi-word string.

#### EDGAR's state-of-incorporation suffix

EDGAR appends `/DE`, `/CI` or `/Cayman` to a conformed name when it needs to
disambiguate one, and `stripEdgarJurisdictionSuffix`
(`src/util/dataCleaningUtils.ts`) drops it before **both** normalizers tokenize.
It is not cosmetic on either tier: the family key kept the marker as a token, so
`Churchill Capital Corp XII` keyed `churchill-capital` while its own
`Churchill Capital Corp IX/Cayman` keyed `churchill-capital-corp-cayman` — one
sponsor, two families — and `normalizeCompanyName` could not reach the legal form
behind it, since `\bCORP\b$` does not match `Blue Acquisition Corp/Cayman`, so
that name minted a second canonical company beside `Blue Acquisition Corp`. The
rule fires only on a trailing `/<alphabetic token ≤ 8>` with an optional trailing
slash, and never empties a name; across the 816 SIC-6770 registrants it matches
exactly 10 names, all of them EDGAR's convention.

#### Diacritics in identity keys

`foldDiacritics` (`src/util/dataCleaningUtils.ts`) folds accented Latin letters
to their ASCII base, so a filer writing `Jörg Müller` in one filing and
`Jorg Muller` in the next names one person.

Two passes, because one does not cover the alphabet: NFD splits a letter from
its combining mark, and an explicit map handles `ø ł đ ð þ ß æ œ …`, which carry
the mark inside the glyph and have no combining form. An NFD-only fold leaves
those for the caller's `[^a-z]` filter, which turns `Søren` into `s ren` and
**deletes** the `Ł` in `Łukasz` — a name silently missing a letter is a
different name. Case is preserved; callers building a key lowercase themselves.

**The person tier folds; the company tier does not.** For persons the fold is
applied to the identity **parts**, not just the hash, so `person_hash_id` and the
`normalized_*` columns `personKey` matches on cannot drift apart. The name as
filed keeps its accents in `first_name` / `last_name`.

On the company side only `generateCompanyHash` folds, and that is a **derived
slug nothing persists** — no table stores `company_hash_id`, and its one in-repo
consumer is the eval scorer's company match key. The key the company tier
actually matches on is `company_observations.normalized_name`, written by
`normalizeCompanyName` (which the resolver's name fallback and
`canonical_company` are keyed on), and that function does not fold. So
`Søren Skou Holdings LLC` and `Soren Skou Holdings LLC` still mint two canonical
companies and two identity links. The remedy is an explicit alias:

```sh
sec canonical company alias "Soren Skou Holdings LLC" "Søren Skou Holdings LLC"
```

Closing the gap for real means folding inside `normalizeCompanyName`, which is a
**re-key of every company observation ever written**. That is now affordable:
`sec resolve --kind company --all --renormalize` recomputes `normalized_name`
from the `name` each observation already carries, then resolves, so a normalizer
change no longer costs a full re-extraction and its AI bill. The recompute calls
the same helpers the extraction path writes with (`normalizePersonNameParts`,
`normalizeCompanyName`) precisely so a second implementation cannot drift and
re-key half the tier to a generation nothing else produces. The fold itself is
still not applied — `CompanyNormalization.test.ts` pins the gap so it cannot land
as a one-line change with no migration — but the migration is now one command.

#### Address normalization: a blank city is stored blank

`AddressSchema.city` is **nullable**, and `normalizeAddress` never invents a
value for it. The ownership forms (3/4/5/144) routinely put the country in
`stateOrCountry` and leave the city blank; the country NAME used to stand in,
which is not a city and — since `generateAddressHash` joins every non-empty
column — went straight into `address_hash_id`. It also mis-resolved the US
territories: `COUNTRY_STATE_CODE_ARRAY` carries `AS` / `GU` / `MP` / `VI` / `UM`
twice, as a US subdivision before the country row, so a `find` on the ISO code
took the first and an American Samoa address was given the city
`"UNITED STATES"`.

The rule now: a **street** is what makes an address usable, a city is still
required for a **US** address, and a foreign one is kept with a null city.

⚠️ Changing it **re-keys every address whose city was fabricated** — non-US
addresses with a blank filer-reported city, and nothing else. Nothing like the
person re-key in scale, and **free**: every writer on this path
(`StoreSubmissionContactInfoTask`, Form D / C / 1-A / 1-K / 1-Z / CFPORTAL,
ownership 3/4/5, Form 144, `s1/xbrlEnrichment`) is deterministic, so there is no
AI cost and no version bump. Tables carrying the old key: `addresses`,
`addresses_entity_junction`, `addresses_entity_history_junction`,
`canonical_person_address`, `canonical_company_address`, and the
`raw_address_id` column on both observation tables.

```bash
sec db setup                       # relaxes the NOT NULL (see below)
sec sync submissions --step submissions
for id in D C 1-A 1-K 1-Z CFPORTAL 3 4 5 144; do sec extractor backfill "$id"; done
sec resolve --kind person  --all
sec resolve --kind company --all
```

Do **not** delete the old rows. `addresses_entity_history_junction` is temporal
and pins the old hash forever, correctly, as a record of what was stored; the
orphaned `addresses` rows are inert residue, exactly like the canonical rows the
company re-key above leaves behind.

⚠️ Skipping steps 2–4 is **silent**: the fabricated cities keep resolving,
nothing errors, and no coverage number drops. Size the job first with
`SELECT COUNT(*) FROM addresses WHERE country_code <> 'US' AND city IS NOT NULL`
and eyeball the result for country display names.

`AddressRegionNullableMigration` is the pattern for relaxing a NOT NULL on
SQLite, where no `ALTER` can do it: rename aside, recreate at the current
schema, copy back, all inside one `BEGIN IMMEDIATE`. It now covers **two**
columns (`NULLABLE_COLUMNS`) rather than the one its name records, and keeps its
`addresses__legacy_region` scratch-table name so a database stranded mid-rebuild
by an older build is still found by the resume probe. Postgres gets the same
relaxation twice over — here and from the generic `alignPostgresColumnTypes`
pass — both catalog probes that no-op once the column is nullable.

#### Re-keying without a version bump

A resolver version bump preserves rows minted under the old normalizer so the
two generations can be compared and rolled between. When the old rows are
disposable, wiping is cheaper and more honest — `version coverage` would
otherwise report against a generation nobody intends to keep.

**What is actually stale** is the PERSON identity generation and the FAMILY
keys: `person_observations.normalized_*` and every `person_hash_id` derived from
one (the fold went into the identity parts, and no SQL can recompute it — it is
TypeScript on the extraction path), plus every
`canonical_*_family.normalized_name` (now derived from the legal name via
`companyFamilyName`). The scripts clear those, the person canonical tier keyed on
them, and everything carrying a person `observation_id`.

**The COMPANY canonical tier is spared from the wipe — but it is not untouched.**
`normalizeCompanyName` changed in the same release, so
`company_observations.normalized_name` — the column `canonical_company` is keyed
on, and the one `CompanyResolver`'s name fallback matches against — is stale
wherever the new rules key a name differently: `Churchill Capital Corp I`
normalized to `Churchill Capital` and now keys distinctly, `Reinvent Technology
Partners Y` no longer collides with `Reinvent Technology Partners`, and
`Blue Acquisition Corp/Cayman` now reaches the legal form behind EDGAR's
jurisdiction suffix. Those are the merged canonical identities the release
exists to split.

It is spared anyway because those rows are **rebuildable, not disposable**:
`normalized_name` derives from the `name` every company observation already
carries, so `sec resolve --kind company --all --renormalize` recomputes it and
re-partitions the tier in place — no re-extraction, no AI cost. Wiping instead
would destroy `canonical_company`, `company_identity_link` and the company
junctions and leave a full re-extraction as the only rebuild, since the
observations `sec resolve` reads are exactly what these scripts keep.

⚠️ **The renormalize pass is required, and nothing errors if it is skipped.**
The stale keys keep resolving, `version coverage` keeps reporting full coverage,
and the merged identities survive silently — so it is step 3b in the ceremony
below, after the backfills and before the alias imports (aliases match on
canonical display names, so they must land against the re-resolved tier).
Expect residue: canonical rows minted under the previous normalized names
survive with zero identity links pointing at them. They are inert, not
corruption; the visible fallout is aliases whose target became one of them,
listed by `sec canonical company alias-list --orphans`.

`observation_provenance` is scoped `WHERE kind = 'person'` because its
company-kind rows (underwriter and issuer observations) cite observations that
survive — and, being keyed by observation id rather than by any normalized
value, they are unaffected by the re-key.

`extractor_runs` / `extraction_dead_letter` are cleared only for the extractors
whose output the scripts actually delete (`REKEY_REEXTRACT_EXTRACTOR_IDS` in
`src/storage/versioning/extractorIds.ts`), so the forms sweep's anti-join
re-selects exactly those filings at the **same** version. Clearing every row
would re-run `8-K` redemption/LOI detection and `merger-proxy` extraction —
AI passes whose output the script never deleted — and re-pay their model cost for
nothing.

That set is the person-observing extractors **plus `424`**, and the `424` is
not an oversight to tidy away: the scripts wipe the FAMILY tier too, and the
family tier is not person-scoped. `runOfferingSections` writes
`underwriter_link` / `underwriter_family_membership` from the priced 424B1/424B4
path under extractor id `424`, and a family link row **is** the attribution —
there is no observation → link projection behind it and batch `sec resolve`
refuses the family kinds, so leaving `424` out of the gates destroys every
424-sourced underwriter attribution with nothing able to rebuild it.
`truncateIdentityTier.test.ts` fails if the SQL and the constant drift, and
separately asserts that a script wiping `underwriter_link` re-extracts `424`.

Raw EDGAR ingest is left alone — nothing in `entities`, `filings`, `cik_names`,
`company_facts` or `xbrl_fact` is keyed by a normalizer, and re-downloading it
costs hours against the rate limit. `family_description` is spared too: it is
hand-curated and its `(family_kind, normalized_name)` key changed, so re-import it
rather than lose it.

**Two files, one per backend, and they are not interchangeable.**
`truncate-identity-tier.sql` is portable DELETE-based SQL for **sqlite3** only;
its table names are unqualified, so running it through `psql` on a deployment
whose `search_path` lists a staging schema first would delete that schema's
identity tier irreversibly. `truncate-identity-tier.postgres.sql` pins the
schema with `SELECT set_config('search_path', current_schema(), true)` (which
sqlite3 rejects, hence the split) and adds `TRUNCATE ... RESTART IDENTITY`. The
two name the same table set, enforced by test.

The pin is `set_config`, **not** `SET LOCAL search_path TO current_schema()`:
`SET` takes identifiers and string constants, never a function call, so that
spelling is a Postgres syntax error. Inside the script's transaction it aborts
every following statement and the `COMMIT` rolls back, so the ceremony prints
errors and wipes nothing — a failure no test reading the file as text would
catch, which is why one now pins the accepted spelling directly.

> ⚠️ **Export your aliases first — they are wiped and cannot be reconstructed.**
> Alias rows are hand-curated claims that two canonical rows are one entity, and
> they are keyed by the canonical UUIDs the wipe destroys, so they cannot be
> spared the way `family_description` is. `alias-list` prints display names
> alongside the ids and `--format tsv` writes the export `alias-import` reads
> back — TSV, not CSV, because canonical names routinely contain commas
> (`Keefe, Bruyette & Woods, Inc.`).

```bash
# 1. Export the hand-curated aliases (names, which survive the wipe)
sec canonical person             alias-list --format tsv > aliases-person.tsv
sec canonical company            alias-list --format tsv > aliases-company.tsv
sec canonical sponsor-family     alias-list --format tsv > aliases-sponsor.tsv
sec canonical underwriter-family alias-list --format tsv > aliases-underwriter.tsv

# 2. Wipe (SQLite; on Postgres use the .postgres.sql variant)
sqlite3 "$SEC_DB_FOLDER/$SEC_DB_NAME.sqlite" < scripts/sql/truncate-identity-tier.sql

# 3a. Re-extract EVERY extractor whose output the wipe deleted, not just S-1.
#     424 is in the list for the FAMILY tier (underwriter links), not persons.
for id in S-1 D C CFPORTAL 1-A 1-Z 3 4 5 144 424; do sec extractor backfill "$id"; done

# 3b. Re-key the COMPANY tier the wipe deliberately spared but the normalizer
#     made stale. Required; cheap (recomputes from stored names); silent if
#     skipped. Must precede the alias imports, which match on display names.
sec resolve --kind company --all --renormalize

# 4. Restore the curated data
sec editorial import data/editorial/family-descriptions.csv
sec canonical person             alias-import aliases-person.tsv
sec canonical company            alias-import aliases-company.tsv
sec canonical sponsor-family     alias-import aliases-sponsor.tsv
sec canonical underwriter-family alias-import aliases-underwriter.tsv
```

Step 3b takes no `--resolver-version`: it defaults to the **active slot** ("next
if a dev cycle exists, else current"), the same rule `version coverage` reads, so
the ceremony never asks an operator to look up a semver mid-run. Pass the flag
to target a different version.

`alias-import` resolves each pair by NAME (the ids in the export no longer
resolve) and reports each pair it cannot place without abandoning the rest — a
name whose canonical row has not been re-extracted yet is an expected partial
failure, not a reason to lose the other forty.

### SPAC consolidated report

A CIK-keyed `spac` row consolidates the SPAC lifecycle for a quick report:
status, three-era names/SIC/tickers (`spac_*` / `post_merger_*` / `current_*`),
amounts (`ipo_proceeds`, `trust_amount`, `current_trust_amount`, `pipe_amount`, `total_redemption_amount`),
and rolled-up key dates. It is **derived** from two append-only tables — `spac_deal`
(one row per business-combination attempt) and `spac_event` (the dated timeline) —
so replays are idempotent; an `as_of` guard protects filing-sourced scalar fields
from out-of-order writes, and `spac_history` + `ChangeLog` version the row.

The IPO half is populated from S-1/DRS (`registration`) and priced 424B1/424B4
(`ipo`). **A vehicle IPOs once.** The `spac` row is deliberately kept past the
combination (the shell keeps its CIK and renames — that is what the three name
eras model) and EDGAR keeps coding the surviving operating company 6770 for
years, so when that company files a 424B4 of its own, both of `isSpac`'s
signals still read true. Two gates stop it being treated as a SPAC unit IPO:
`isSpac` is false once `status` is terminal (`completed` / `liquidated` /
`withdrawn`), and `recordSpacIpoEventIfEligible` refuses when an `ipo` event
already exists under a **different** accession. The first is what keeps the
follow-on's terms out of `spac_unit_terms` (`isSpac` picks the destination
table and gates sponsor-promote extraction); the second is the backstop for a
vehicle whose `completed` event has not landed yet. Keying the second on the
accession rather than on `ipo_date` is what keeps a replay of the same filing
working across a version bump or a dead-letter retry.

A database that ingested follow-on prospectuses before those gates existed
carries duplicate `ipo` events and repriced IPO figures. Find them with a
`GROUP BY cik HAVING COUNT(*) > 1` over `spac_event` where `event_type = 'ipo'`.
`spac.ipo_proceeds` is recoverable from the earliest `ipo` event's `amount`
(`recordIpo` passes it), but `trust_amount` and `spac_tickers` are not on the
event and need `sec extractor backfill 424 --force` — which first requires the
affected rows' `as_of` to be cleared along with those three columns. Otherwise
`buildSpacRow` marks the true IPO filing stale (`filingDate < existing.as_of`)
and `pick()` refuses to clobber a non-null, so the re-run silently leaves the
follow-on's numbers in place. Leave `spac_history` alone: it is the audit trail
of what the row said.

De-SPAC **milestone dates** come from 8-K item codes (known SPACs only
— a `spac` row must already exist), but the mapping is **not 1:1**: the same
item code carries a de-SPAC milestone on one filing and ordinary corporate
housekeeping on the next, so `mapItemCodesToSpacEvents` classifies each code
into a lifecycle type or a non-lifecycle one (`material_agreement` / `eight_k`,
which no deal walk reads):

| item   | lifecycle type         | condition                                                                                            |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `2.01` | `completed`            | unconditional                                                                                        |
| `1.01` | `definitive_agreement` | the submission carries a merger-shaped EX-2 exhibit AND the event is not dated before the date floor |
| `1.02` | `terminated`           | a deal was pending as of that filing, or the exhibits are merger-shaped                              |
| `5.07` | `vote`                 | a deal was pending as of that filing AND it had a proxy date                                         |

Item `8.01` carries **no lifecycle mapping at all** — `mapItemCodesToSpacEvents`
falls through its `default: break` and writes nothing. A termination disclosed
only under 8.01 (a common way to announce a dead deal) therefore leaves the
attempt `pending` indefinitely, with whatever proxy/vote dates it reached.

The date floor is `ipo_date`, falling back to `registration_date`. It exists
only to reject the SPAC's own pre-IPO underwriting and formation agreements, so
an **unknown** floor does not demote: `ipo_date` is written by `recordIpo`,
which `processForm424` runs for a priced prospectus (424B1/424B4, or a 424B3
that is the vehicle's IPO prospectus) filed by a CIK that either carries a 6770
SGML header or already has a **non-terminal** `spac` row — and never twice,
since an existing `ipo` event from a different accession stops it, so a
de-SPAC'd company's follow-on cannot reprice the IPO. A row minted by the S-1
AI content classifier (a SIC-miscoded filer) legitimately has none until its
own priced prospectus lands. The real discriminator is the EX-2 exhibit.

**The pending-deal hint is computed from the event stream strictly BEFORE this
accession** (`pendingDealBefore`), never from the currently derived deal set.
That is what makes replay idempotent, and it is easy to reintroduce: reading
the derived deals makes filing N's classification depend on filings that came
after N, so reprocessing N demotes its lifecycle event — and
`recordDealMilestones` replaces every item-mapped row for the accession before
appending, so the demotion deletes the event the first pass wrote.

Classified events group into `spac_deal` attempts via `deriveDeals` (recomputed
from the event stream on every write, so `deal_index` is stable across replays)
and roll up automatically. `target_name`, `pipe_amount`, and redemption amounts
stay null until the narrative/AI extractors (S-4 / DEFM14A / 425) land — 8-K
item codes carry no names or amounts.

**Deregistration and unit separation.** Form 25 / 25-NSE / Form 15 (extractor
id `25-15`) are metadata-only. An **exchange 25-NSE within 180 days of IPO**
is unit separation — units stop trading so shares/warrants/rights can trade
separately (Nasdaq often files one 25-NSE per class; a second in that window
is still a split). That writes a `unit_split` event, fills `unit_split_date`,
and advances status `ipo` → `searching`. It does **not** fail the vehicle and
does not close a pending deal. Issuer Form 25, the Form 15 family, and a
25-NSE **after** that 180-day window write `deregistration`, which closes a
leftover pending deal and fails the vehicle.

**A pending deal only makes a listing removal a close within
`LISTING_REMOVAL_MAX_DAYS_AFTER_APPROVAL` (90 calendar days) of its proxy or
vote**, anchored on the LATER of the two (a superseding proxy revives an
attempt). Reaching the ballot is not closing: a deal can die after its vote, and
when that is disclosed only under Item 8.01 — which writes no lifecycle event —
the attempt stays `pending` with its `vote_date` forever, so an unbounded
"has a proxy or vote" test read the eventual wind-up's Form 25 / Form 15 as a
completed combination. A 5.07 extension meeting also maps to `vote` whenever a
deal is pending, so a `vote_date` does not even mean the merger was approved.
A real post-approval close is days — the trust has to be released; the widest
pairing in the committed corpus is **40 days** (Columbus Circle, proxy
2025-11-12 → Form 15 2025-12-22), the rest 2, 3, 6, 8, 10 and 19. The window is
**one-sided**: a removal filed before the approval is not housekeeping for it.
The same bound governs the 20-F branch.

**An unknown IPO floor does not demote a 25-NSE** — same rule as the 8-K
item-1.01 date floor above, and for the same reason: `ipo_date` is written only
by `recordIpo`, which `processForm424` runs for a priced prospectus filed by a
CIK carrying a 6770 SGML header or a non-terminal `spac` row (see the date-floor
note above), so a SPAC minted by the S-1 AI content classifier (the
SIC-miscoded case that path exists to catch) has none until its own priced
prospectus lands.
Classifying its routine post-IPO unit separation as `deregistration` marked a
live searching vehicle permanently `liquidated`. So an exchange 25-NSE with an
absent `ipo_date` writes `unit_split`; a KNOWN `ipo_date` keeps the 0–180 day
window and still deregisters outside it. The allowance is applied **after** the
nearby-20-F FPI-close check, not inside the post-IPO window test, and the
ordering is load-bearing: an FPI close carries no `ipo_date` either, so letting
an unknown floor claim `unit_split` first would misfile every miscoded FPI close
as a unit separation — trading one wrong answer for another. The 20-F check gets
first refusal on the same filings. The allowance is exchange-only —
issuer Form 25 and the whole Form 15 family deregister regardless, because a
real wind-up files exactly those. It is self-correcting (once the 424 lands,
`deregistrationDescriptor.filterTodo` re-derives the kind and re-queues, and
`recordDeregistration` deletes the sibling `unit_split` on the same accession
before appending — symmetric in both directions), and inert in the rollup with
no `ipo` event, since `deriveStatus` reads `unit_split` only inside its `hasIpo`
branch: status stays `registered` and `unit_split_date` is filled without
claiming an IPO. Recover affected rows with `sec extractor backfill 25-15`
(metadata-only, free, no `--force`) — **run it until it reports `processed 0`**:
`filterTodo` re-derives each accession's kind against the live classifier, and
`hasPriorCompleted` reads the event stream, so a stale `completed` sitting on an
EARLIER accession keeps a later one classifying `completed` and skipped. Only
after the earlier accession is corrected does the next pass see the later one.
A deregistration ordered at or
before a `completed` event is **post-close housekeeping and does not fail the
deal** — the completion is dated by the 8-K's REPORT date while the Form 25
event is dated by its FILING date, so the routine delisting of a de-SPAC'd
shell's units routinely collides with or sorts ahead of the closing it follows.
`deriveDeals` therefore ignores liquidation/deregistration entirely when the
stream carries a completion anywhere.

The whole 8-K / proxy / 25-15 tier is gated on the `spac` row that the
registration statement mints, and each handler records a **successful** run
when the row is missing — so a sweep that reaches them first drops their events
with nothing to re-select the filing. `sortFormsForSweep`
(`storage/versioning/extractorIds.ts`) gives `sec sync` form-domain leaves an explicit
registration → prospectus → 8-K → proxies → 25/15 order rather than relying on
`Object.keys` (which enumerates the integer-like `"25"` fourth). For filings
ingested before that fix, or before their issuer's S-1 was processed, recover
with `sec extractor backfill 25-15` — its `filterTodo` already selects
known-SPAC Form 25/15 filings that have no `deregistration` or `unit_split`
event for the accession, so no `--force` is needed (repeat until `processed 0`,
per the fixpoint note above).

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

`surviving_name`, `post_merger_sic`, `post_merger_tickers` and the `current_*`
promotion are **derived strictly from a completed deal**, never merged forward.
A rebuild whose event stream no longer derives one drops all of them — the
`current_*` chains collapse back to the `spac_*` mirror — so a filing
reclassified from `completed` to `deregistration` cannot leave a wound-up shell
reading as the operating company forever. All five columns are in
`TRACKED_FIELDS`, so the correction is captured in `spac_history` / `ChangeLog`.
Genuinely completed SPACs are re-filled afterwards by `sec spac
backfill-despac`.

**Current trust.** `trust_amount` is the IPO-day deposit. The live balance
(interest, extension deposits, redemptions) is `current_trust_amount` /
`current_trust_as_of`, lifted from company facts tagged `AssetsHeldInTrust*`
on 10-Q/10-K. `sec sync facts` refreshes a CIK as it stores; `sec spac
backfill-trust` sweeps every known SPAC. The filing `as_of` anchor is not
moved, so IPO scalars stay order-safe.

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
retires the 8-K path's positional merge-preserve. Preliminary (`PREM14A`/`PREM14C`)
and revised (`DEFR14A`/`PRER14A`) proxies are extraction-only. S-4 is deferred
(newco-CIK linkage). Configure the
model via `SEC_MERGER_PROXY_MODEL` (default `claude-sonnet-5`) and an optional
confidence floor via `SEC_MERGER_PROXY_CONFIDENCE_FLOOR` (falls back to the shared
`SEC_S1_CONFIDENCE_FLOOR` when unset).

#### Announced deal values

Alongside `target_*` / `pipe_amount`, the merger-proxy extractor reads the deal
values the proxy ANNOUNCES — `equity_value` and `enterprise_value` of the
combined company — and `deriveDeals` correlates them onto the matching
`spac_deal` by the same filing-date window, so a definitive proxy supersedes a
preliminary one exactly as the target does.

They exist because a completed combination is otherwise unvaluable. The market
never priced the target (it was private), and its book equity is a private
company's accounting rather than what was paid for it, so the announced deal
value is the only stated number that answers "what was this worth at the
combination".

**A figure written in the units of its own sentence is dropped, never stored and
never rescaled** (`dealValueScale.ts`, floor `MIN_PLAUSIBLE_DEAL_VALUE` =
$10,000,000). A prospectus says "$1.4 billion" and a model can answer `1.4`, or
`1400`; both validate against the schema, both store, and both become a
valuation off by a factor of a million that nothing downstream re-derives — a
percentage change computed against one is merely very large rather than
obviously wrong. The floor separates the two populations with nothing near it: a
real combination is tens of millions at minimum (the trust alone is), and a
scaled figure is single or quadruple digits. Rescaling instead of dropping would
be a second model of the filing, and a wrong guess is indistinguishable from a
right one once stored; a null says what is true, that the proxy stated a value
and the figure read back could not be used. The prompt states the unit at the
point the number is produced, which is the other half of the fix.

Both fields are `Type.Optional` on the model schema, like `target_description`,
so a replay under an older extractor version still validates. Adding them is a
**minor bump** — run the ceremony before re-extracting:

```bash
sec version start-dev extractor merger-proxy --minor
sec version promote extractor merger-proxy
sec extractor backfill merger-proxy
```

#### Which statements emit the `proxy` event

The `proxy` event (→ `proxy_date` / `status = proxy`) is **two-tier**, and the
tiers differ in what counts as evidence:

- The **definitive merger** statements `DEFM14A` / `DEFM14C` emit it on the form
  symbol alone — the symbol says the meeting is about a combination, so the
  event still lands when the merger section is absent or low-confidence and the
  section dead-letters. (A consent deal (14C) has no `8-K 5.07` vote, so the
  definitive 14C is its only approval-stage signal.)
- The **general definitive** statements `DEF 14A` / `DEF 14C` — which is where
  most SPACs actually vote their combination — emit it only on **two**
  conjunctive pieces of document evidence: an extracted deal AND
  `seeksCombinationApproval` (`proxies-information-statements/seeksCombinationApproval.ts`),
  a deterministic scan for a numbered proposal item naming the filer's defined
  `Business Combination Proposal`, or a request to approve/adopt the **agreement**
  (business combination agreement / agreement and plan of merger / merger
  agreement).

The extracted deal alone is not evidence, because an **extension** proxy recites
the announced combination at length: `S1_SECTIONS.BUSINESS_COMBINATION` accepts a
bare `The Business Combination` heading, so the section is found, the model
returns a target, and the filing looked exactly like a merger proxy. That is a
silent corruption, not a missing row — a `proxy` event OPENS a deal by itself in
`spacDealGrouping.ts`, which makes the vehicle's next item `5.07` a merger
`vote`, which makes any Form 25/15 inside the 90-day post-approval window a
`completed` de-SPAC, with `surviving_name` promoted onto `current_name`.

The gate is deliberately **deterministic rather than a model schema field**.
The failure costs are asymmetric: a false positive corrupts the primary answer
with no trace, while a false negative only degrades a fallback — a real close
files an Item 2.01, which maps to `completed` unconditionally. A model field
also could not repair existing rows without re-paying the AI bill, and making it
required would force an extractor version cycle. Same reasoning as the ownership
subtotal and risk-caption heading guards: enforce it, don't trust the prompt.

Two rules the patterns must keep, both measured over 348 real SIC-6770
`DEF 14A` / `DEF 14C` statements (9 merger proxies, 339 extension / annual /
other; the rule scores 9/9 recall at **0 false positives**):

- **Never match the term anywhere in the document.** Every extension proxy
  carries "as if they had voted against a business combination proposal", and
  many cross-reference the combination's own proposal in another filing. A
  whole-document test for `business combination proposal` fired on 24 of the
  348, **all** of them extension or annual meetings. Both patterns are therefore
  line-shaped (≤ 300 chars) and the defined-term one is anchored at line start.
- **The approval object must be the AGREEMENT.** A bare
  `to approve … business combination` is the standard extension wording — "to
  approve an amendment … to extend the date by which the Company must consummate
  a business combination".

There is deliberately no extension-exclusion term: a proxy asking for an
extension AND for approval of the combination is a genuine merger proxy and must
still emit.

Extraction is unchanged either way — the `spac_merger_extraction` row is written
whether or not the gate passes — and the verdict is recorded on it as
`seeks_combination_approval`. `NULL` means the gate was not evaluated: the row
predates it, or the form symbol alone decides (the "M" forms never pay the
full-document render). The backfill keys on that NULL, so it must stay
distinguishable from a recorded `false`.

**Retraction.** `recordMergerProxy` deletes a `proxy` event for the accession
when the caller now decides the filing is not approval-stage, mirroring the
sibling deletes in `recordDeregistration` / `recordUnitSplit` / `recordCompleted`.
Reclassification therefore runs in both directions and a replay demotes the deal
instead of leaving the old verdict standing. The delete is scoped to that one
accession, so it can only retract what a previous run of the same filing wrote.

**Only a verdict about the DOCUMENT moves the event, which is why the writer
takes a tri-state rather than a boolean** (`ProxyEventVerdict`:
`emit | retract | leave`, decided by `resolveProxyEventVerdict`). `runSection`
contains every model and transport failure as a dead letter and returns
normally, so "the model said this filing discloses no deal" and "the provider
throttled us" both arrive as an unset `extractedDeal`. Read as a boolean the
second retracted a `proxy` event an earlier successful run had recorded from
real evidence — and losing it takes the whole approval stage with it, since the
vehicle's next Form 25/15 inside the 90-day post-approval window then classifies
`deregistration` instead of `completed` and `recordDeregistration` deletes the
`completed` event: a genuinely de-SPAC'd vehicle recorded as a wind-up, from a
run that merely could not reach a model. So a general definitive statement
retracts only on `seeks_combination_approval === false` — deterministic, and
conjunctive with the deal, so it decides alone and keeps the recovery ceremony
working during a provider outage — or on a dead letter that IS an answer
(`SECTION_NOT_FOUND` / `MODEL_EMPTY`, `NO_DEAL_REASONS`). Everything else,
including `LOW_CONFIDENCE_ALL` and `UNVERIFIED_SOURCE_SPAN` (where the model did
return a deal and only its certainty or its citation failed), leaves the stream
untouched.

The deterministic verdict is recorded on an existing extraction row **even when
the run extracted nothing** (`SpacMergerExtractionRepo.recordApprovalVerdict`),
because the gate really was evaluated — it is a property of the document, not of
the model call. Left NULL, the backfill's null-verdict clause re-selects the
same filing on every sweep, which is what made the failure repeat rather than
happen once. No row is invented where none exists: every predicate downstream
reads an extraction row as "this proxy produced something".

No extractor version bump: the persisted extraction rows are unchanged and still
correct, and the derived event is rebuildable from the document with no model
call.

**Recovery ceremony.** Databases populated before the gate existed carry false
closes. Re-run the proxies, then let the listing-removal classifier re-derive
the Form 25/15 verdicts that were built on them:

```bash
sec extractor backfill merger-proxy   # re-derives the verdict; retracts stale proxy events
sec extractor backfill 25-15          # repeat until it reports `processed 0`
```

The first re-selects exactly the general definitive proxies whose
`seeks_combination_approval` is still NULL, and extinguishes itself once each
has a verdict. The second is the fixpoint sweep documented above: `filterTodo`
re-derives each accession's kind against the live classifier, so a stale
`completed` on an earlier accession keeps a later one classifying `completed`
until the earlier one is corrected.

Find the affected rows first — every `proxy` event on a general definitive form,
and the closes standing on one:

```sql
SELECT cik, accession_number, event_date, form FROM spac_event
WHERE event_type = 'proxy' AND form IN ('DEF 14A','DEF 14C') ORDER BY cik, event_date;

SELECT p.cik, c.accession_number AS close_accession, c.form, c.event_date
FROM spac_event p JOIN spac_event c ON c.cik = p.cik AND c.event_type = 'completed'
WHERE p.event_type = 'proxy' AND p.form IN ('DEF 14A','DEF 14C')
  AND c.form IN ('25','25/A','25-NSE','25-NSE/A','15-12B','15-12G','15-15D','20-F','20-F/A');
```

⚠️ Expect status **regressions** on real CIKs as the false closes unwind —
`completed` back to `searching` / `deal_announced`, and `surviving_name` /
`post_merger_*` / the `current_*` promotion dropping back to the `spac_*` mirror
(those five columns are derived strictly from a completed deal and are never
merged forward). That is the correction, not a loss: every change is captured in
`spac_history` / `ChangeLog`, and genuinely completed SPACs are re-filled by
`sec spac backfill-despac`.

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

"No redemption reported" is the expected answer for most trigger 8-Ks, so its
`MODEL_EMPTY` dead-letter is auto-resolved. A `MODEL_INVALID_OUTPUT` entry stays
**pending**: it is the section runner's catch-all for an unclassifiable throw,
not a verdict about the filing. The detector still records a **successful** run
row for that filing, so the ordinary forms sweep will not re-select it and the
pending entry is the only surviving trace. `sec spac backfill-redemptions`
re-selects exactly those filings — a catch-all entry (in any status) with no
`spac_redemption_extraction` row — alongside the ones that never ran.

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
(genuine problems — low confidence, unverified span, nonce mismatch, and the
`MODEL_INVALID_OUTPUT` catch-all — stay **pending**). As with redemptions, the
detector records a **successful** run row even for a section that threw, so the
ordinary forms sweep will not re-select the filing and the pending entry is the
only trace; `sec spac backfill-lois` re-selects exactly those filings — a
catch-all entry (in any status) with no `spac_loi_extraction` row — alongside the
ones that never ran. Configure the model via `SEC_LOI_MODEL` (default
`claude-sonnet-5`) and an optional floor via `SEC_LOI_CONFIDENCE_FLOOR` (falls
back to `SEC_S1_CONFIDENCE_FLOOR`).

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
sec spac backfill-trust [--dry-run]     # refresh current trust from 10-Q/10-K company facts
sec extractor backfill 25-15            # recover deregistrations gated before their spac row existed
```

### SPAC identification from submissions (`spac_candidate`)

`spac` is populated by the S-1 extractor, which needs the filing document. The
`spac_candidate` table is the cheap screen that runs off **submissions metadata
alone** — no document fetches — so a usable list exists the moment submissions
are ingested, and so the forms sweep has a worklist to aim at.

```bash
sec sync spacs --step identify                        # incremental: CIKs whose submissions changed
sec sync spacs --step identify --full                 # rescan every entity
sec spac candidates [--confidence high] [--limit n] [--format csv|json]
sec spac download registration [--confidence high,medium] [--force]
sec spac download 8k
sec spac download everything
```

`sec spac download` fills the on-disk `accessiondocs` cache for those candidates
**without** running extractors. Default confidence is high+medium. Registration
downloads the S-1/F-1/DRS family; `8k` every `8-K`/`8-K/A`; `everything` every
filing for those CIKs. Already-cached files are skipped. Run this before
`sec sync spacs` / `sec spac process` so the forms sweep is a cache hit.

The fetch asks for `response_type: "stream"`: this command exists to FILL the
cache, not to read it, so nothing here wants the document as a value. The cache
file is the artifact and success is the absence of an error. That deletes a
recovery branch the materializing path needed — a binary primary document
(`.pdf`, `.jpg`) resolved to `blob`, so `fetchOutput.text` was undefined and the
fetch threw "Fetch returned no text" AFTER the bytes were already cached, and an
`existsSync` check had to discover the download had in fact worked. The one step
that genuinely needs the text, the 8-K primary-doc slice, reads the cached
submission back.

The fetch also runs with **`shouldAccumulate: false`**, and that flag is what
makes `"stream"` mean what it says. The cache sink receives every chunk without
it, but `StreamProcessor` ALSO tees each `binary-delta` into an in-memory
accumulator and materializes the whole document at finish — so a command whose
entire point is not to hold the document still held a full copy of every filing
in flight, ten at a time. The relaxation that skips the tee
(`canStreamBinaryToCache`) is computed only for a task the GRAPH schedules,
which is why the two bulk downloads above get it from `noAccumulation` and this
one does not: an owned child runs through its own `run()`, where accumulation
stays on by default because a standalone runner cannot see whether anyone reads
the value. Here nobody does — the 8-K slice reads the cache file back. Measured
on a 128 MiB body, the finish event carried the whole thing and peak off-heap
memory ran ~4x the document; with the flag it carries nothing and the file is
still written whole. `DownloadSpacCandidateDocsTask.test.ts` asserts the finish
event has no `body` while deltas did flow, so the property cannot regress into
a memory-only symptom nothing catches.

`inputToFileName` does not include `response_type`, so this `"stream"` fill and
a later `"text"` fetch of the same document address the **same** cache path —
which is what makes the two interchangeable across commands. The streamed copy
is in fact the more faithful of the two: `"text"` serializes a UTF-8 decode,
lossy on invalid sequences (`U+FFFD`), while `"stream"` writes the origin's
bytes verbatim.

`--force` **deletes** the cache entry and then re-fetches. The delete is the
point: the fetch task's own file cache keys off that exact path and is consulted
before the fetch runs, so without it a "re-fetch" is served from the very file
being replaced and a corrupt entry can never be evicted. Deleting is also the
only variant that keeps `SecFetchFileOutputCache`'s tmp+rename as the single
writer — `CacheCoordinator.lookup` and `.save` share one gate, so a
cache-bypass flag would suppress the write too and force a non-atomic
hand-rolled one.

> ⚠️ The delete precedes the fetch, so a `--force` run whose fetch then fails
> leaves NO cached document — a merely-stale entry ends up empty, and a mistyped
> broad run evicts a large cache before re-fetching it at the SEC rate limit.
> This is **not** the behavior of `sec bootstrap download-docs --force`, which
> streams from a tarball and overwrites once the bytes are in hand, so it has no
> such window. Scope a `--force` run before using it; losses show up in the
> `failed` count and a re-run refills them.

Failures never abort the sweep: each one is counted with a short reason (404 vs
403 vs an exhausted-retry 429 stay distinguishable), warned per filing, and
tallied by reason at the end. A fetch that reports success but leaves no cache
file is counted as a failure too — the streaming path holds nothing else, so
there is no value left to fall back on, and reporting it beats returning a
success that left the cache empty for the later forms sweep to miss on. Skips
are reported three ways — already-cached, no filename on the filing, and a
filer-authored name that could not be made path-safe — because only the first is
a healthy steady state.

Four signals, each kept as its own column so a consumer can re-derive its own
rule: `entities.sic = 6770`, a blank-check-shaped current name, a
blank-check-shaped _former_ name, and — `signal_filed_sic_6770` — whether a
registration this filer filed carried a **6770 header SIC as filed**. That last
one is the only signal a completed de-SPAC cannot erase: it recodes AND renames,
so the other three vanish together (Joby, Opendoor, Hippo, E2open, Markforged
and Banzai each fell out of the screen entirely), while the registration
statement's own header still reads 6770 forever. It is read from
`s1_classification.sic`, where `processFormS1` already writes the value it
parsed out of the SGML header — no second copy, and no column on `filings` for
the next submissions refresh to overwrite with null. `null` means no
registration of this filer has been parsed yet, which is not the same as false.
Graded into `confidence`:

- **high** — an S-1-family registration (`S-1`/`F-1`/`DRS` + amendments) plus
  either a blank-check name (current or former), EDGAR's 6770 coding, or a
  registration filed under a 6770 header, with nothing arguing against it. The
  as-filed header sits on this rung because a registration filed under it IS a
  blank-check IPO by construction — a stronger claim than the current-SIC
  signal, which only says the filer reads 6770 today. The name half survives the de-SPAC, which is
  exactly where `sic = 6770` fails: DraftKings reads 7990 today, Lucid 3711.
  6770-plus-registration sits here on measurement (150 of 168 such 2019-2024
  registrants appear in embarc's curated list, 89%).
- **medium** — one weakened or contradicted signal: a weak-class name with a
  registration and nothing else, or a 6770 filer that registered only AFTER
  shedding a blank-check name.
- **low** — a blank-check name only in history with the registration filed
  after the rename (the Form 10 shell pattern: register on 10-12G,
  reverse-merge, then S-1 for the operating company's resale), OR 6770 with no
  registration on file at all.

A latest `s1_classification.is_spac = false` (by filing date) also caps identify
at `low`, and `sec sync spacs` process skips that CIK even if an older candidate
row is still medium. That is how an operating company that only _looks_ like a
blank check (Associates First Capital, Sprint Capital) leaves the worklist
without a fourth confidence rung. A CIK that already has a `spac` row is never
dropped this way — a post-de-SPAC operating S-1 must not eject the vehicle.
`null` (no registration parsed yet) leaves the ladder in place.

Why the screen is worth having at all: `entities.sic` is the _current_ code, and
it drifts off 6770 at the de-SPAC — sometimes before the rename (Melar
Acquisition Corp. I reads 7389 while its own S-1 header says 6770). The header
is the authority, but EDGAR increasingly omits it: Viking Acquisition Corp I's
S-1 carries no `STANDARD INDUSTRIAL CLASSIFICATION` line at all, so the
extractor's deterministic check falls through to the AI content classifier.

The name patterns were mined from the names EDGAR itself codes 6770, scored by
the share of S-1-family registrants matching each pattern that carry that code
(an undercount — a de-SPAC's SIC has already moved off it):

| pattern             | 6770 / matched | example                      |
| ------------------- | -------------- | ---------------------------- |
| `%acquisition%`     | 1099 / 1342    | the anchor                   |
| `%partnering corp%` | 5 / 5          | Corsair Partnering Corp      |
| `%opportunit%corp%` | 15 / 17        | Elliott Opportunity II Corp. |
| `%growth corp%`     | 12 / 14        | Cartesian Growth Corp IV     |
| `%merger corp%`     | 16 / 23        | Legato Merger Corp. III      |

Rejected on the same measurement: `%capital corp%` (31/99 — Sprint Capital, BBX
Capital and other lenders), `%investment corp%` (BDCs, mortgage REITs),
`%holdings corp%` (19/153), `%ventures corp%`, `%spac%` (matches "space"). Only
LP/LLC legal forms are excluded, never a bare "partners": 12 of the 13
registrants named both "acquisition" and "partners" without an LP/LLC suffix are
coded 6770 (Supernova Partners Acquisition Co III, Catalyst Partners …).

A second, weaker class (`MODERN_SPAC_NAME_PATTERNS`: `%capital corp%`,
`%investment corp%`, `%special purpose%`) makes a company a candidate and can
reach `medium`, but never `high` on its own. These are near-certain in the
modern era (29/32, 37/40, 5/5 among 2019-2024 registrants) and near-worthless
before it — "Capital Corp" is what SPRINT CAPITAL CORP, BBX CAPITAL CORP and
EVEREN CAPITAL CORP called themselves, and over all vintages the pattern
collapses to 33/103. SIC 6770 or a strong name is what lifts them to `high`.

The recall/precision tables below were measured on this rule.

**Validation against embarc's curated list** (`embarc/data/generated/spacs.json`,
1,476 SPACs, S-1 dates 2006-03 → 2025-05):

| Reference vintage | In list | Found | Recall  |
| ----------------- | ------- | ----- | ------- |
| 2021-2025         | 1,005   | 977   | 97%     |
| 2019-2020         | 379     | 340   | 90%     |
| 2015-2018         | 78      | 62    | 79%     |
| overall           | 1,476   | 1,387 | **94%** |

Recall by lifecycle status shows where the screen is strong and why:

| Status                              | In list | Found | Recall   |
| ----------------------------------- | ------- | ----- | -------- |
| Withdrawn (registered, never IPO'd) | 207     | 207   | **100%** |
| Failed (IPO'd, no combination)      | 492     | 485   | 99%      |
| S1 / Unit / DA / IPO (in flight)    | 211     | 207   | 98%      |
| Completed (de-SPAC'd)               | 567     | 489   | 86%      |

**A SPAC that withdrew or liquidated is still a SPAC** — the attempt is the
fact worth recording, and it is what sponsor-level grading is built on. Those
are exactly the ones the screen never loses: a vehicle that never completed a
combination keeps its blank-check name and its 6770 coding forever. Only a
_completed_ de-SPAC erases its own evidence, by renaming and recoding to the
operating business, and 78 of the 89 total misses are that case: CENAQ Energy
Corp, CC Neuberger Principal Holdings, Landcadia Holdings III, dMY Technology
Group III, GigCapital3, Social Capital Hedosophia — names sharing no token with
any other. No name rule reaches them; the as-filed header SIC in the forms
pipeline is what closes that gap.

In the other direction the screen finds high-confidence SPACs the curated list
does not have: 751 registered from 2006 on — before its coverage starts (the
2007-08 wave), after it ends, and at the recent edge where it thins out — plus
more from the pre-2006 era it does not cover at all.

Known false positives: transaction merger subsidiaries ("DEAC NV Merger Corp",
"AECOM MERGER CORP") and operating companies that happen to fit ("Canopy Growth
Corp"), roughly 6 of the 65 matches the non-"acquisition" patterns add.

### The web inspector (`sec web`)

```bash
sec web [--port 8787] [--host 127.0.0.1]
```

A local, server-rendered interface over the SPAC pipeline: the candidate screen,
one issuer's report and full history, the per-filing process checklist with the
controls to run it, the HTML→markdown conversion each filing goes through, every
row the extractors wrote for it, and a multi-model comparison of one section.
It exists because verifying an extraction means moving between those views —
a missing row is a segmentation miss, a conversion problem, or a model miss, and
only having all three in front of you separates them. `embarc-data web` is the
same command: the superset inherits it through `AddCommands`.

**Loopback by default, and that is a security boundary rather than a default
port choice.** The server has no authentication and its buttons start runs that
spend real model quota and real EDGAR budget, so binding it where a network can
reach it has to be typed (`--host 0.0.0.0`) and warns when it is.

Pages:

| path                             | what it answers                                                        |
| -------------------------------- | ---------------------------------------------------------------------- |
| `/candidates`                    | the `spac_candidate` screen, filterable; rebuild button; per-row links |
| `/spac/<cik>`                    | the `spac` row, the deals and events it derives from, full history     |
| `/spac/<cik>/process`            | the issuer's timeline as a checklist, with run controls                |
| `/spac/<cik>/filing/<accession>` | document + conversion, extraction results, model comparison            |
| `/runs`, `/runs/<id>`            | what has been run, with a live transcript                              |

Four things about it are load-bearing:

- **The checklist and the replay are computed by one function.**
  `planSpacTimeline` (`src/task/spac/planSpacTimeline.ts`) owns the timeline
  ordering and the already-succeeded / gated / date-floor selection, and both
  `ProcessSpacTimelineTask` and the web run driver read it; the second, capped
  repair pass is likewise `planSpacTimelineRepair`. A page that computed its own
  answer would eventually disagree with the pipeline about what is outstanding,
  which is the one thing a verification surface must never do. The
  per-step-reporting driver is what the web adds, not a second selection rule.

- **Runs execute strictly one at a time.** A model choice is applied by setting
  the environment variable the extractor reads at call time
  (`withModelOverrides`), which is process-global — two concurrent runs with
  different models would each observe the other's. Serializing also keeps the
  fetch budget and per-CIK write ordering behaving as they do under the CLI.
  A run reports progress over an SSE stream rather than holding a request open:
  a de-SPAC'd company's timeline runs for the better part of an hour.

- **The document viewer opens the file the pipeline parsed**, through
  `isFullSubmissionForm` / `isSpacNarrativeTrigger8K` exported from
  `ProcessAccessionDocFormTask`. Reading the primary document for an S-1 instead
  would show a cover page and report every section as missing on a filing that
  extracted perfectly well — a viewer that disagrees with the pipeline about
  which bytes are the filing is worse than no viewer.

  Its panels **fetch their text when they are opened** (`/api/document`, plain
  text): inlining every one made the page 745 KB of HTML for a single S-1 — the
  whole raw source, the whole markdown and every section — almost all of it
  behind collapsed `<details>` nobody had opened, now 9.8 KB. The character
  COUNTS stay in the page, because "this section is missing" is the answer a
  reader is usually after and it must not cost a click. Conversions are memoized
  by path + size + mtime under a byte budget, so opening a second panel does not
  re-parse a 3.2 MB prospectus (measured: ~1 ms per panel after the first), and a
  re-download evicts. A panel is capped at `DOCUMENT_PART_PREVIEW_CHARS` and the
  cut names the `&full=1` that lifts it — a truncation with no way past it is why
  people go looking for the file on disk.

- **The extraction viewer derives its tables from `SEC_STORAGE_REGISTRY`**, not
  from a per-extractor list: every table carrying an `accession_number` column is
  searched, so a newly registered extraction table appears with no second place
  to remember. Tables holding nothing are counted rather than listed, so "nothing
  was extracted" stays distinguishable from "not looked at". It runs on the
  extractions tab ONLY — the sweep asks every accession-keyed table for this
  filing's rows, and on a real database several of those are full scans, which
  the document tab was paying for and then discarding. Three tables are skipped
  outright (`SKIPPED_TABLES`): the two rendered in their own shape above, and
  `company_facts` — the bulk companyfacts ingest for a whole CIK, where
  `accession_number` is provenance rather than a key, unindexed, the largest
  table in the database, and populated from 10-K/10-Q, none of which are forms
  this UI opens. The filing's own XBRL is `xbrl_fact`, which is keyed by
  accession and still shown. A superset adds its
  own through `registerWebExtractionTables` (the companion to
  `registerDbStatsTables`) — without it an `embarc-data` filing page shows every
  sec row for an accession and silently omits the superset's own, which reads as
  "that extractor wrote nothing".

**The model comparison writes nothing, and runs on the queue.** It sends one
filing's segmented section to each candidate model via `EVAL_EXTRACTORS` and
scores the rest against the FIRST one, which stands in as the reference — so it answers "would another
model read this section better", and adopting one stays a separate, explicit act
(pick it in the process page's model picker and re-run the filing). It is a
comparison, not a verdict: `sec eval s1 --reference golden` is what scores a
model against human-verified truth.

A comparison is a sequence of cloud calls over a section that can run to 57k
characters — tens of seconds each, one model at a time — so it is enqueued like
any other run rather than held open as a form POST, which showed a dead page for
its whole duration. The page follows it on the same event stream the process
page uses, reporting each model as it lands, and the answer is kept on the run
record: a comparison persists nothing, so that is the only place it exists.

Results are read as a **table** — a row per aligned entity, a column per model,
aligned by the extractor's own `keyField` (positionally where it declares none,
exactly as `scoreExtraction` aligns). A model that DROPPED an entity is then a
gap in a column rather than an absence to be spotted by diffing four JSON dumps,
and rows the models disagree on are highlighted. A model whose run failed is
omitted from the columns rather than rendered as blanks, which would read as
"it dropped everything". The per-model JSON stays available under it.

It also shows the **whole prompt**, not just the section: the injection-hardening
preamble, the extractor's instructions, and the section fenced as untrusted
filer text, built through the production `buildExtractionPrompt` rather than
reassembled — a preview that composes its own preamble is a second
implementation of the prompt, and the first thing it would do is drift. The
instructions alone and the output schema (through `schemaForPrint`, so it is the
shape the current nonce setting really sends) get their own panels, since those
are the parts you edit and the part that decides what a schema failure means.
Those four panels are lazy in the same way the document tab's are, over
`/api/prompt` — a prompt runs to 31k characters and the section it fences can
reach 57k, so inlining all four put a quarter of a megabyte in a page whose
reader usually wants one of them. **Show prompt only** resolves the section and
renders all of it without calling a model — inspecting what a model is about to be asked is the cheapest step in the
loop and should not cost an API call. With `SEC_EXTRACTION_NONCE` on, the page
says so: a cloud provider's real prompt then carries a per-attempt verification
token, so no single rendering is _the_ prompt and what is shown is the no-nonce
shape.

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
`spac_merger_extraction` row, since its known-SPAC gate records `success: true`,
plus the general definitive proxies whose `seeks_combination_approval` verdict is
still NULL — a self-extinguishing clause, since the re-run records one).
The default needing-work predicate is a bulk anti-join against `extractor_runs`
at the active version, exported as `defaultFilterTodo` so a descriptor that only
WIDENS it does not restate it. The `redemption` / `loi` descriptors do exactly
that: their `filterTodo` is the default UNIONED with filings whose detector
section carries the `MODEL_INVALID_OUTPUT` catch-all and produced no extraction
row. Those recorded a successful run while writing nothing, so the anti-join
alone never revisits them. `MODEL_EMPTY` entries are deliberately excluded — a
confident negative is the expected answer for most trigger 8-Ks and must not be
re-paid as an AI call on every sweep. Each survivor re-runs `ProcessAccessionDocFormTask`, so
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

  `registerDbStatsTables` (`src/cli/queries/DbStatus.ts`) is the reporting half
  of that seam — a superset's tables are counted by `db stats` alongside sec's
  own — and a registered table the database has not created reports `n/a`
  (`rows: null`, with a "run `db setup`?" hint) rather than failing the whole
  report; only a missing relation degrades, every other error still throws.

  **Row counts on Postgres are estimates by default.** `db status` / `db stats`
  read `pg_stat_user_tables.n_live_tup` rather than scanning, and that statistic
  is refreshed by ANALYZE/autovacuum, so it lags recent writes. The report says
  so: `db stats` heads the column `Rows (est.)` and marks each estimated row
  `(est.)`, `db status` appends `  (estimated)`, both print a footer pointing at
  `--exact`, and `--format json` carries `estimated` per row (`db stats`) and per
  result (`db status`). Two things the query gets right that the naive form does
  not:
  - The relation name is **schema-qualified to `current_schema()`**
    (`to_regclass(quote_ident(current_schema()) || '.' || quote_ident($1))`,
    still fully parameterized). Unqualified, `to_regclass('filings')` resolves
    through `search_path` and on a deployment whose path lists a staging schema
    first would report the OTHER schema's count under sec's table name — the
    hazard `resetAllDatabases` already qualifies its drops against.
  - **A zero estimate falls back to the exact count.** `n_live_tup` is 0 until
    the first ANALYZE, so right after `sec bootstrap` bulk-loads ~1M `cik_names`
    the estimate reads 0 — `db status` printed `Entities: 0 / Filings: 0` under a
    column labelled "Rows", inviting an operator to read a stale statistic as a
    real count. Zero now means "no statistics yet"; a genuinely empty table pays
    one cheap `COUNT(*)` for that.

  `db setup` finishes with two schema-catch-up passes, in this order (both run
  after the extension loop, so a superset's tables are registered first).

  First, an **add-missing-column pass** (`addMissingColumns.ts`): a pure
  `planMissingColumns` plus a thin executor per backend. `CREATE TABLE IF NOT
EXISTS` is a no-op on an existing table and `createStorage` declares no
  `tabularMigrations`, so a column added to a schema after a database was
  created never appears in it — and nothing else closes that gap, since the
  alignment pass below deliberately skips a column the live schema lacks. Every
  write goes through `putBulk` with the full row, so the first write after the
  schema change fails outright: `spac_candidate.signal_filed_sic_6770` broke
  `sec sync spacs` on every pre-existing database that way. It runs before
  the alignment pass so a freshly-added column is eligible for widening in the
  same `db setup`, and it subsumes the hand-written `spac.current_trust_*`
  migration that used to sit beside it. `backfillExtractorRunsOutcome` stays
  hand-rolled — it seeds `outcome` from `success`, which no generic pass can
  express.

  Two rails, both load-bearing. Only **nullable** columns are planned: SQLite
  rejects `ADD COLUMN NOT NULL` without a default, and there is no honest
  default for a signal nobody has computed for the existing rows. And an
  **unmappable declared type is skipped with a warning, never guessed** — a
  missing column fails loudly on the next write, whereas a column created at
  the wrong type is accepted and mismatches silently until some value does not
  fit. Non-goals, all deliberate: NOT NULL columns, type changes, drops,
  renames, backfills. Stating a type means carrying a JSON-Schema → DDL mirror
  of a `workglow` emitter this repo does not own, so
  `schemaTypeMirror.sqlite.test.ts` creates every registered table on real
  SQLite and requires the mirror to have predicted each emitted type; a column
  the mirror declines must be in a short explicit allowlist there. Three are:
  `investment_offerings.exemptions` and `rega_offerings.securities_offered_type`
  (arrays, where the two backends genuinely differ) and
  `underwriter_link.role_detail` (declared `type: ["string", "null"]`, which
  the emitter itself does not recognize).

  Second, a **column-alignment pass**
  (`alignPostgresColumnTypes`). `CREATE TABLE IF NOT EXISTS` never alters an
  existing table and the declarative migration op set has no `alterColumn`, so
  a database created before a column was widened or relaxed would otherwise
  keep the old shape forever and keep rejecting real EDGAR values. The pass
  reads `information_schema` and issues only one-directional `ALTER TABLE`s —
  widen a `varchar` (up to unbounded `text`, when the schema dropped its
  `maxLength`), drop a `NOT NULL` — which makes it idempotent (empty plan
  on a fresh DB). Postgres only; SQLite emits TEXT, and its one NOT NULL
  relaxation needs the rename/recreate rebuild in
  `AddressRegionNullableMigration`. A relaxation with no such migration —
  `filings.primary_doc` — therefore reaches Postgres on the next `db setup` and
  a pre-existing SQLite database not at all. That is a widening, so an old
  SQLite file keeps exactly today's behavior (it still rejects a null
  `primary_doc`) rather than breaking; only new databases gain the ability to
  store one. ⚠️ Widening a `varchar` is
  binary-coercible so the heap is not rewritten, but every index on the column
  — including the unique index backing a primary key — is rebuilt under an
  ACCESS EXCLUSIVE lock. On a large deployment, run `db setup` in a maintenance
  window. A **type** change on a column a view reads is skipped with a warning
  naming the view and the exact DDL, rather than failing the whole setup; a
  `DROP NOT NULL` is never view-gated, because Postgres does not refuse it.

  Every statement either pass emits is **schema-qualified to
  `current_schema()`**, resolved once per run (`quote` / `currentSchemaName` in
  `src/util/pgIdentifiers.ts`, shared with `db reset`). Both read their catalog
  `WHERE table_schema = current_schema()`, so an unqualified `ALTER TABLE` would
  alter a different table than the one the catalog measured whenever the
  `search_path` lists another schema first — and the identifier is quoted, since
  Postgres folds an unquoted one to lower case and `current_schema()` returns a
  mixed-case name verbatim.

  `db reset` drops only what sec owns: every table built through
  `createStorage` (recorded in `src/config/tableRegistry.ts`, supersets
  included), the `current_canonical_*` views, and the Postgres rate-limiter
  tables. The rate-limiter names are **derived**, not literals:
  `PostgresRateLimiterStorage` names its tables after its prefix columns, so
  `setupSecFetchRateLimiter` and the reset both read one configuration
  (`SecFetchRateLimiterOptions` / `secFetchRateLimiterTableNames`,
  `src/task/fetch/secFetchRateLimiterConfig.ts`) — sharding the fetch budget by
  a prefix column renames the tables on both sides at once instead of silently
  orphaning them (the derivation is pinned against the installed storage's own
  migration DDL by `resetAllDatabases.test.ts`). Every Postgres drop is
  schema-qualified to
  `current_schema()` — an unqualified name resolves through the search*path and
  would reach a same-named table in the \_next* schema on it. Tables it does not
  own are left in place and named in a warning. `--cascade` drops dependent
  objects; `--drop-schema` restores the old whole-schema drop (Postgres only,
  destroys unowned objects too). A drop blocked by a dependent object raises an
  error naming the table, Postgres's DETAIL, and both flags. On Postgres the
  whole set of drops runs in one transaction, so a blocked drop rolls the
  earlier ones back rather than leaving a half-dropped database that the failed
  command never recreates.

  `_storage_migrations` is **not** dropped. It is `@workglow/storage`'s
  applied-version ledger — one fixed-name table that every package built on the
  library records into, a row per `(component, version)` — so dropping it would
  take a co-tenant's rows with it and make their next setup replay `addColumn`
  ops against tables that already carry those columns. It is left standing and
  reported like any other unowned table. Its rows are still scoped, though:
  the reset issues a `DELETE ... WHERE component = ANY(...)` over the components
  sec's own setup records under, read back from the storage that writes them
  (`secFetchRateLimiterLedgerComponents`). That delete is mandatory, not tidy —
  a runner skips a `(component, version)` it finds recorded, so a row outliving
  the table its migration created would stop `db setup` from ever recreating it.
  Today the set is exactly the Postgres rate limiter's: no sec table declares
  tabular migrations, and `createStorage` does not accept them. `--drop-schema`
  still takes the ledger, along with everything else in the schema.

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
- **`src/config/`** — Dependency injection setup. `tokens.ts` defines DI tokens, `EnvToDI.ts` reads env vars, and `storageRegistry.ts` declares every tabular storage sec owns as one `{ token, table, schema, primaryKeyNames, indexes, uniqueIndexes }` list. Both bootstraps map over that list rather than repeating it: `DefaultDI.ts` builds each entry through `createStorage` (SQLite/Postgres), `TestingDI.ts` builds each as an `InMemoryTabularStorage`. Add a table by adding one `defineStorage({...})` entry — plus its `setupDatabase()` / `deleteAll()` call in `setupAllDatabases.ts` / `resetAllDatabases.ts`, which their coverage tests enforce against the registry.
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

### The fetch layer and `response_type`

`SecCachedFetchTask` takes a domain key (a CIK, an accession, a date), not a
URL, so it builds the request in **`resolveFetchInput`** — the seam every
dispatch path runs through. Not `execute()`: `FetchUrlTask` is streamable, so
`TaskRunner` always dispatches to `executeStream` and a subclass `execute()`
override is never invoked (its constructor throws on one rather than letting the
URL derivation be silently skipped).

`response_type` is `"stream" | "text" | "json" | "blob" | "arraybuffer"` and is
required upstream. A caller-supplied value is always honored, including
`"stream"`; the URL-extension guess (`guessResponseType`) decides only for a
caller that stated nothing, and never yields `"stream"` — materializing is the
right default for a parser-facing fetch, and asking for bytes-only is an
explicit decision about who reads the result.

**`SecFetchFileOutputCache` is what makes `"stream"` usable on a cached fetch.**
It implements `saveOutputStreamPort` — the single capability probe the cache
coordinator keys its binary sinks on — writing to the same path
`inputToFileName` yields for a materializing fetch, with the same
tmp-then-rename discipline so a stream that fails mid-body never renames a
truncated file into place. Two consequences worth knowing:

- **The row save that follows the sink is skipped**, detected by `body` carrying
  a `CacheRef` (or by `response_type` being `"stream"`). `saveByPolicy` runs
  after the streaming sink and targets the same path, so re-serializing there
  would overwrite the bytes the sink just committed — with a re-encode of the
  value derived from them for a materializing type, and with an **empty file**
  for `"stream"`.
- **An unrecognized `response_type` is a cache MISS**, not an empty hit.
  `outputDeserializer` filling no field used to hand back `{}`, which `getOutput`
  reported as a hit holding nothing — read downstream as "the document was
  empty" rather than "no entry", so the fetch was skipped and the caller parsed
  nothing.

`SecFetchJob` retries on 429/5xx/DNS/connect and per-attempt timeouts, but
**only before the first byte reaches a stream receiver**. Past that point the
receiver's subscription outlives the attempt, so a re-issue starts again at byte
0 and concatenates a second body onto the first with nothing marking the seam.
Nearly every retryable condition lands before any body byte, so the loop keeps
its value. The ban is enforced twice over: upstream re-classifies a mid-body
failure as a non-retryable `BODY_TRUNCATED`, and this loop latches its own
delivery flag because a per-attempt timeout arrives as a bare abort that keeps
its shape through that classification and would otherwise drive straight through.

### SQLite initialization

`src/sec.ts` invokes **`Sqlite.init()`** when the installed `workglow` package defines it (`typeof Sqlite.init === "function"`), so newer Workglow releases load the SQLite binding before `getDb()` opens a database. Older `workglow` versions without `init` skip this step.

**`getDb()` is SQLite-only.** It throws `SecCliConfigurationError` when `SEC_DB_TYPE !== "sqlite"` to prevent the silent data divergence that occurred before (`getDb()` would open a stray SQLite file even under Postgres, and rows written through it never reached the configured backend).

Code that needs a raw SQL fast path beyond what `ITabularStorage` exposes dispatches through **`resolveSqlBackend(access, repo)`** (`src/util/sqlBackend.ts`, also exported from the barrel): SQLite → `getDb()`, Postgres → `getPgPool()`, otherwise → the repository (tests / in-memory). `"sqlite"` requires the full production config, not just `SEC_DB_TYPE` — `getDb()` dereferences `SEC_DB_FOLDER` and `SEC_DB_NAME` unconditionally. Both parameters are required so each call site states its intent rather than inheriting a default that silently changes behavior.

Two guards override the configured backend and force the repository path:

- **Dry run — `access: "write"` only.** `--dry-run` is enforced by `createStorage` wrapping every storage in `ReadOnlyTabularStorage` (writes no-op, reads forward). A raw-SQL write goes around that wrapper and would commit for real, so `resolveSqlBackend` returns `"repository"` whenever `isDryRun()`; the wrapper forwards no `isDurable()`, so the durability guard cannot stand in for this one. A raw-SQL **read** commits nothing, and demoting it would be a silent pessimisation (`listFilingDates` streaming the whole `filings` table instead of one indexed `SELECT DISTINCT`, the observation-title `IN`-list collapsing back into an N+1), so `access: "read"` keeps the fast path under dry run.
- **A non-durable repo** — **pass the repo whenever you have one.** An in-memory store is invisible to `getDb()`/`getPgPool()`, so a fast path would silently target a different store. This is reachable in one process, not merely across test files: `EnvToDI` defaults `SEC_DB_TYPE` to `"sqlite"` and `.env.test` supplies `SEC_DB_FOLDER`/`SEC_DB_NAME` to the vitest workers, so anything running `EnvToDI` (or a CLI preAction hook) while holding an in-memory repo satisfies every token check. Across test _files_ the registry is already clean — `resetDependencyInjectionsForTesting` strips these tokens (they are in `ENV_DERIVED_TOKENS`) and vitest runs `isolate: true` with `pool: "forks"` — so the guard is about in-process mixing, not leakage.

Call sites: `cikNameBulkWriter.ts`, `Form8KEventReplace.ts`, `SpacDealReplace.ts` (writes); `feedFilings.ts` (reads). The raw **DDL** in `setupAllDatabases.ts` / `resetAllDatabases.ts` is not a fast path and keeps its own `isDryRun()` guard.

Note that a bulk read is **not** a reason to reach for it. `ITabularStorage` now expresses set membership directly — `query({ col: { value: [...], operator: "in" } })`, added in `@workglow/storage` 0.3.37 — so "rows for these N ids" is one query through the abstraction, on every backend. `PersonObservationTitleRepo.listForObservations` is the worked example: it joins titles onto a page of person observations with one `in`-list query per chunk of ids instead of one query per person. Chunking is the caller's job only because SQLite (and DuckDB) bind one parameter per value and stay subject to `SQLITE_MAX_VARIABLE_NUMBER`; Postgres binds the whole list as one array parameter. It previously took ~90 lines of hand-written dual-dialect SQL to say that.

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
- `SEC_FETCH_MAX_PER_SEC` — EDGAR fetch RATE, in requests/second, shared across
  every process via the cluster rate limiter (default 8, clamped to 1–8 so a
  stray value cannot approach EDGAR's 10/s ceiling)
- `SEC_FETCH_MAX_CONCURRENT` — EDGAR fetches IN FLIGHT at once, per process
  (default 16, clamped to 1–64). The two are independent limits and both are
  needed: the rate limiter meters STARTS over a one-second window and its
  reservations age out rather than being held until completion, so on its own it
  admits `rate x latency` requests — a slow EDGAR serving multi-MB
  full-submission `.txt` documents at 30s each puts ~240 fetches in flight, and
  at roughly two file descriptors apiece that exhausts the process's descriptor
  table (macOS's default `ulimit -n` of 256 goes first). The concurrency
  limiter holds its slot until the job reaches a terminal state, which is what
  bounds the peak. At the default pair it binds only once a fetch averages over
  two seconds, so a healthy sweep is unaffected
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

Enforced in CI by `bun run format-check`, so run `bun run format` before
pushing. The version is **pinned exactly** (`prettier` in `devDependencies`, not
a range): a floating range reformats on a minor release and turns CI red on a
day nobody touched the code.

Two `.prettierignore` entries are load-bearing and should not be tidied out:

- every `mock_data/` directory — captured EDGAR bytes, not source. `goldenFixtures.test.ts`
  re-hashes the `src/sec/html/mock_data/{s1,424}` corpus against the SHA-256
  recorded in `goldenFixtureManifest.ts` with no network, so reformatting a
  fixture turns that test red and destroys the capture provenance the manifest
  exists to prove (a bare `prettier --write .` rewrites 28 of them). The
  fixtures under the other `mock_data/` trees back whitespace-sensitive prose
  segmentation and source-span verification, where re-indenting changes what
  the tests measure. The entry names the directories rather than the files that
  fail today, because a fixture that is prettier-clean today is clean by
  accident of its markup, not by guarantee.
- **`src/eval/goldenS1Labels.ts`** — one label per line so each can be checked
  against the filing it came from. Prettier collapses them onto single lines;
  19,950 of the 21,757 lines a repo-wide reformat would change are in this one
  file, and the result is the opposite of reviewable.
