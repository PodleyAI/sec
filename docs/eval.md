# Model comparison harnesses

`sec eval` compares extraction models on **correctness, speed and cost**, so you can find
the cheapest/fastest model that still extracts correctly.

Three harnesses:

| Command               | Reference                                  | Input                                              |
| --------------------- | ------------------------------------------ | -------------------------------------------------- |
| `sec eval extract`    | hand-authored `expected` rows              | committed golden fixtures (`src/eval/fixtures.ts`) |
| `sec eval s1`         | committed golden labels, or a model oracle | real committed S-1 sections                        |
| `sec eval unit-terms` | embarc's curated unit structure            | real committed S-1 "The Offering" sections         |

All three support `--print-prompts instructions|templates|full` to print prompts and exit
without making model calls.

---

## 1. `sec eval extract`

Runs committed fixtures through each candidate model and ranks them.

```bash
sec eval extract                              # default: haiku, sonnet, deepseek-flash, gemini-flash
sec eval extract --models "claude-haiku-4-5,onnx:onnx-community/Qwen3-4B-Instruct-2507-ONNX"
sec eval extract --extractor management --format json
sec eval extract --fixture s1-management-operating-company --models "claude-haiku-4-5"
```

Registration in `EVAL_EXTRACTORS` does **not** imply a fixture: `--extractor` errors out for
an extractor with none (rather than sweeping zero runs and reporting a vacuous pass), and its
help lists only the scorable ones. `related-party` and `offering-terms` still have no
fixture; `offering-terms` is covered instead by `sec eval unit-terms`.

The documented default set is cross-provider — `claude-haiku-4-5`, `claude-sonnet-5`,
`deepseek-v4-flash`, `gemini-3.6-flash` — so a full bare run wants **three** keys:
`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`. **A default whose key is absent is
skipped with a warning** naming the ids and the missing variables, rather than sweeping into a
table half full of failed runs presented as if the models had been ranked and lost. An
explicit `--models` is never filtered: naming an id is a request to run it, and a failed run
is the honest answer.

Cross-provider head-to-head — each id routes by shape, so each provider used needs its own
key. An id a provider does not serve is recorded as a failed run, not a crash; verify ids
against each provider's models endpoint.

```bash
sec eval extract --models "claude-opus-5,claude-sonnet-5,claude-haiku-4-5,\
gpt-5.5,gpt-5.4-mini,gemini-3.1-pro-preview,gemini-3-flash-preview,grok-4.5,\
deepseek-v4-flash,deepseek-v4-pro"
```

### Reading the table

The `ok` column is **successful runs / total runs**, where total is
models × fixtures × `--runs` — **not** a retry count. `--extractor management` has two
fixtures, so a clean sweep of one model reads `2/2` and `1/2` means one fixture failed (named
underneath). Retries are a separate inner loop: `runStructured` passes `maxRetries: 1`, so
`StructuredGenerationTask` reports "after 2 attempt(s)".

**Every score is averaged over ALL runs including failures** (a failure scores 0), so one
perfect and one failed fixture reads 50% across the board; `latency` is likewise a mean.

`rows` (raw) and `dist` (post-dedupe) sit side by side — the gap is duplicate
over-production. `scoreExtraction` de-duplicates candidate (and reference) rows on the
extractor's key field before scoring: a model emitting the same entity twice is
over-producing _rows_, not inventing distinct hallucinations, so precision is computed over
distinct rows.

Models are registered on demand via `registerModelIds`, so any candidate id works; a model
that fails to resolve or errors on a fixture is a failed run rather than an aborted sweep.
Add an extractor by registering it in `EVAL_EXTRACTORS` and adding a matching fixture.

---

## 2. Scoring

`scoreExtraction` (`src/eval/scoreExtraction.ts`) aligns candidate rows to `expected` by a
key field and scores field-level agreement, normalized (case/whitespace) and forgiving of
provenance fields. It reports `score` (names + titles), `found` (entity recall) and `prec`
(1 − hallucinated rows).

### `personNameFields` is person-only

An extractor may declare `personNameFields` so credentials do not split identity ("Isaac
Manke" aligns with "Isaac Manke, Ph.D."), and every harness passes it — `eval extract` and
`eval s1` must score one extractor by one set of rules.

It is restricted to **person-only** extractors (`management`, `executive-compensation`):
`normalizePerson` is lossy on organization names in exactly the way that matters, reading a
legal-form suffix as a credential, so `WAVE Equity Fund, L.P.` and `WAVE Equity Fund, LLC`
both hash to `wave-equity-fund` and collapse into one row. `beneficial-ownership` — whose
`name` is a person OR an entity, per its `owner_kind` — declares none, names the field under
`entityNameFields` instead, and lets the row's own `entityKindField` pick the parser per row.
`fixtures.test.ts` fails any extractor declaring the flag while carrying an `owner_kind` /
`entity_kind` discriminator.

### The discriminator is key material the reference side must carry

`matchKey` namespaces a name by its row's kind, so a golden label or fixture row that omits
`owner_kind` keys as raw text while every candidate row keys as `person:`/`company:` (the
extractor's schema makes the field required) — the two sides then align on nothing and a
perfect model scores 0/0/0, with every owner reported as BOTH missing and hallucinated.

Every committed `beneficial-ownership` row therefore carries it, `O()` takes it as a
**required** argument (a default is how the two sides drift apart again), and two guards hold
the line: `fixtures.test.ts` fails a fixture row missing it, and `goldenS1Labels.test.ts`
requires `compareFields + entityKindField` on every golden row.

It is **excluded from the defaulted field set** — `eval s1` passes an explicit `compareFields`
that never names it while `eval extract` passes no `fields` at all, so scoring it would have
the two harnesses measuring different questions. Belt-and-braces, alignment falls back to
**exact normalized text** when the kind-aware keys miss: strictly stricter than either
identity hash, so it recovers a one-sided or disagreeing kind without ever merging
`WAVE Equity Fund, L.P.` with `WAVE Equity Fund, LLC`.

### Cost and speed

**Cost is estimated** (`src/eval/modelPricing.ts`: ~4 chars/token × public per-M pricing;
local models $0). Absolute dollars are approximate; the ranking is what matters.

**Speed is wall-clock latency per extraction, under whatever parallelism the sweep ran at.**
`sec eval s1` therefore labels the column `lat@<s1>x<section>x<model>`: a `1x5x4` figure is not
comparable with a `1x1x1` one, and the published haiku-vs-sonnet numbers below were measured
**serially**. Wall-clock includes time queued behind the sweep's own other extractions — a
local model's especially, since one worker serves them all. Set all three `--concurrency-*`
flags to 1 for figures comparable across runs.

---

## 3. `sec eval s1` — oracle over real S-1s

Scores candidates over **real committed S-1 sections**. `realSections.ts` segments the HTML
into the target sections.

The reference defaults to **`golden`** — the committed human-verified labels in
`goldenS1Labels.ts` — because a fixed yardstick is worth more than a strong one: a model
oracle caps every candidate at its own accuracy, costs a call per section, and disagrees with
ITSELF between runs, so the bar moves under you. Golden labels are free, instant and stable.

Pass `--reference <model-id>` (use the strongest available, currently `claude-opus-5` — never
the model you are evaluating) to fall back to an oracle for unlabelled extractors, accepting
that its verdict is an opinion. The reference retries a few times per section (strong models
intermittently emit a nested array as a JSON _string_ the strict schema rejects); a section
the reference still fails is dropped from scoring.

```bash
sec eval s1 --models "deepseek-v4-flash"                     # golden truth: deterministic, $0
sec eval s1 --reference claude-opus-5 --models "claude-haiku-4-5" \
  --extractors "management,beneficial-ownership,related-party"
sec eval s1 --cik 2147219 --models "deepseek-v4-flash"       # narrow to one filer
sec fetch s1-fixtures -c 20 && sec eval s1 --models "claude-haiku-4-5" \
  --dir src/sec/html/mock_data/s1/.cache                     # larger fetched sample
```

### Coverage is derived from the labels, not fixed

Every extractor with at least one committed label is scored, and
`defaultGoldenSweepExtractors()` (`src/eval/defaultSweepExtractors.ts`) is what both the
default `--extractors` set and the `--help` line read — so the current list is always one
`--help` away. As committed today that is 11 extractors over 42 labelled filings:
`beneficial-ownership`, `executive-compensation`, `management`, `offering-terms`,
`related-party`, `spac-classification`, `spac-profile`, `spac-sponsors`, `sponsor-promote`,
`underwriters`, `use-of-proceeds`.

A twelfth, `risk-factors`, is labelled but flagged `disabled` in `EVAL_EXTRACTORS` — "exclude
from **default** sweeps", not "hide from the labels index". `extractorsWithGoldenLabels()`
stays the complete index (the coverage guards in `goldenS1Labels.test.ts` read it to prove
every committed label is reachable); `defaultGoldenSweepExtractors()` is that index minus the
flagged ones, and both harnesses derive their default through the same
`participatesInDefaultSweeps` predicate. Naming it explicitly still runs it.

A golden run scores the sections carrying a label and reports every other one as skipped
rather than quietly passing it. **The reverse gap is reported too**: a committed label whose
_fixture_ never arrives is listed in `skipped` rather than silently dropped. That is not
hypothetical — embarc-data vendors its own copy of the S-1 corpus (`SEC_S1_MOCK_DIR`), and
when that copy drifted behind sec's the labelled filing produced no section at all, so the
sweep scored fewer filings than the labels covered and still printed a clean table. Re-copy
the corpus into the vendoring package when you add a fixture.

The committed set is roughly 400 labelled (filing, section) pairs across the 12 labelled
extractors — densest on `risk-factors`, `spac-classification` and `use-of-proceeds` (42
filings each), thinnest on `spac-sponsors` (2). Titles are stored in canonical
(`normalizeManagementTitles`) form and unit-tested to stay canonical.

### Cost

> ⚠️ **A bare `sec eval s1` is not a cheap command.** Under the default golden reference the
> default extractor set sweeps roughly 350 sections over prose running from a few thousand
> chars to ~57k, for one candidate model. Adding `--extractors risk-factors` adds 42 more
> sections and materially more than 42 calls, since that extractor chunks a ~246k-char
> section into several — which is why it is excluded by default.

Budget it, or narrow it: `--extractors` picks the sections, `--cik <csv>` picks the filer
(leading zeros optional), and the two compose. A CIK matching no fixture is an error listing
the available ones — an empty sweep would otherwise read as a pass. Only the candidate side
costs money under `--reference golden`; a model reference roughly doubles the calls and pays
the reference model's rate on top.

### Concurrency

Three nested axes, each with its own flag; extractions in flight is at most their product
(default `1 x 5 x 4 = 20`):

| flag                          | default | bounds                               |
| ----------------------------- | ------- | ------------------------------------ |
| `--concurrency-s1`            | 1       | filings extracted at once            |
| `--concurrency-section`       | 5       | sections of one filing at once       |
| `--concurrency-section-model` | 4       | candidate models scoring one section |

That product is an **upper bound, not a measurement**. Each axis is separately capped by the
work available to it — the filing count, the widest filing's section count, and the number of
ids `--models` named — so a bare `sec eval s1` (default `--models` is a single id) reaches at
most `1 x 5 x 1 = 5` in flight while the request reads `1 x 5 x 4 = 20`. The `lat@…` header
and the footer therefore report the **effective** triple, and the footer names the requested
triple as well whenever the two differ, so a capped axis reads as a cap rather than an ignored
flag. The section figure is a per-filing **maximum**, not a uniform width. `--format json`
carries both `concurrency` and `effectiveConcurrency`.

There is deliberately **no per-provider awareness** — no grouping candidates by vendor, no
per-provider limiter. The operator manages provider load with these flags, which is also why
the model axis is a flag at all: it used to run at `candidates.length`, so `--models` with ten
ids silently put 50 extractions in flight rather than the 20 the defaults describe. Naming a
model is not a concurrency decision.

Filings are grouped (`groupSectionsByFiling`) before the outer map, so the sweep finishes a
filing before starting the next. That composes with Ctrl-C: an interrupted sweep still prints
what completed — per-section results are checkpointed as they finish and the `skipped` list
says how many of how many sections the table covers — and with grouping, what it leaves behind
is whole filings rather than a scatter of partly-covered ones.

The oracle streams per-section progress to **stderr** (`[i/N] filing extractor (chars)
ref/cand: ok/FAIL ms rows`) so a long local-model run is not blind; `--format json` on stdout
stays clean.

---

## 4. Why golden truth matters — two worked examples

**Ownership subtotals.** The `beneficial-ownership` oracle numbers were long depressed by an
_unstated convention_, not by model capability. Ownership tables end in an
`All officers and directors as a group (N)` subtotal; the prompt never said whether to emit
it, so the reference model emitted it for most tables and omitted it for others — and, typed
`owner_kind: "company"`, the S-1 persist path resolved those subtotal labels into the
canonical company tier while their aggregate share counts double-counted the members above
them. With the convention pinned (prompt + `isOwnershipGroupSubtotal` guard) and golden labels
committed, sonnet **and** haiku both score 100% agreement / recall / precision across all five
sections — with haiku at ~2.8x lower cost. **A model-reference oracle could never have
surfaced this: the reference _was_ the model making the mistake.**

**Zero-holding rows.** An ownership table lists officers and directors who hold nothing,
printing `-` in both columns; the disclosure IS that they hold none. The prompt said to use
null "for figures shown as '\*', '—', or blank" but never said the ROW still had to be emitted,
so `deepseek-v4-flash` dropped four such owners from the TEN Holdings table and scored 95%
recall. The golden labels were right and the model was wrong — the opposite of the Haldeman
title case found in the same run, where the label was wrong and the model right. Both were
only resolvable by re-reading the filing, which is the actual discipline: **a disagreement
says one of the two is wrong, not which.** With the row rule pinned, recall went to 100% and
the fix generalized to a filing the model had never seen (Rainier, four all-dash rows, 100%).

---

## 5. `sec eval unit-terms`

embarc's curated SPAC unit structure (unit price, warrant fraction, rights) is committed as an
extraction truth dataset (`src/eval/mock_data/embarc-spac-unit-terms.csv`, 1,283 CIKs; loader
in `src/eval/embarcUnitTermsReference.ts`). The harness segments each committed S-1's "The
Offering" section, runs `extractOfferingTerms` per candidate model, and scores price / warrant
fraction / rights fraction against embarc's values — rounded to 2 decimals on both sides,
because `scoreExtraction` compares numbers exactly and 1/3 repeats.

```bash
sec eval unit-terms --models "claude-sonnet-5,claude-haiku-4-5"
sec eval unit-terms --dir src/sec/html/mock_data/s1/.cache
```

`SEC_UNIT_TERMS_REF` overrides the reference CSV (mirroring `SEC_S1_MOCK_DIR`) for a
downstream package consuming the published tarball, which ships no `mock_data/`. Fail-fast
semantics: when the env var is set, a missing file **throws** naming the variable and path
rather than falling through to the package-relative default, so a typo cannot masquerade as
"fixture missing, using default".

---

## 6. Choosing a model

> **Verdict: use the cheap cloud tier, not a local model.** Measured against golden truth on
> the committed `beneficial-ownership` sections, **haiku-4-5 matches sonnet-5 at 100%
> agreement / recall / precision for ~2.8x less** — so that is where the savings are.
>
> Small local models are not a substitute for production extraction: they hard schema-fail on
> real sections (emitting `owner_kind` values outside `person|company`, share counts in the
> `confidence` field), and they hallucinate entities memorized from pretraining — one returned
> a well-known SPAC sponsor for an unrelated issuer's ownership table, which is the failure
> mode that matters most for a filings dataset. Rank any candidate yourself rather than
> trusting a headline number.

**DeepSeek** is the cheapest cloud tier by a wide margin — at list price `deepseek-v4-flash`
is $0.14/1M input vs `claude-haiku-4-5`'s $1.00, roughly **8x cheaper** on an input-heavy
section. That is a reason to _rank_ it, not to adopt it: score it against golden truth first,
and read the schema-enforcement warning in `docs/extraction.md` §1. Its cost line uses
DeepSeek's **cache-miss** input price, since each section is a distinct prompt that never hits
the context cache; DeepSeek has also announced (not yet enabled) 2x peak-hour pricing, which
the table does not model.

Adopting it is a per-deployment env-var opt-in, never a change to the built-in default (which
stays a schema-enforced Anthropic id): set `SEC_MODEL_DEFAULT=deepseek-v4-flash` to switch
every extractor, or `SEC_S1_RISK_FACTORS_MODEL=deepseek-v4-flash` to switch only the chunked
risk-factors section that dominates per-filing cost.

**A local HuggingFace model** is set via `SEC_HFT_MODEL` (e.g.
`onnx:onnx-community/Qwen3-4B-Instruct-2507-ONNX` — the `onnx:` prefix is required). Only
**non-thinking** instruct models work for `json-mode`; a thinking model wraps the JSON in
reasoning.

### Evaluating a local GGUF (e.g. Bonsai 27B)

PrismML **Bonsai 27B** (Qwen3.6-based, Apache-2.0) runs through the existing node-llama-cpp
path — there is **no special model id or route**; it is just a `gguf:` model. Point a `gguf:`
candidate at a HuggingFace quant URI and the download-before-use harness fetches it into the
GGUF models dir (`$SEC_GGUF_DIR`, else `$SEC_RAW_DATA_FOLDER/gguf`, else `./models`) on first
use; or pre-stage the file and pass its path.

```bash
sec eval s1 --reference claude-sonnet-5 \
  --models "gguf:hf:prism-ml/Ternary-Bonsai-27B-gguf:Q2_0" \
  --extractors "management,beneficial-ownership,related-party"

huggingface-cli download prism-ml/Ternary-Bonsai-27B-gguf \
  Ternary-Bonsai-27B-Q2_0.gguf --local-dir "${SEC_GGUF_DIR:-./models}"
sec eval s1 --reference claude-sonnet-5 --models "gguf:Ternary-Bonsai-27B-Q2_0.gguf" \
  --extractors "management,beneficial-ownership,related-party"
```

A 27B model wants a GPU/Metal box with enough VRAM (a run-on-your-Mac eval, not a CI one);
raise `SEC_GGUF_CONTEXT` (e.g. `32768`) for the largest S-1 sections. Bonsai is a **thinking**
model, but the llama.cpp `json-mode` here is **grammar-constrained**, so structured extraction
stays schema-valid without a reasoning preamble leaking in — unlike the HFT ONNX caveat above.

Large sections (40–57k chars) dominate wall-clock: sonnet takes ~20s each, and a local HFT
model minutes.
