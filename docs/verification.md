# Verification

`sec verify` accounts for what the pipeline did to a filing, one stage at a time. Every
command here is deterministic and makes **no model call**: it runs the same parser,
segmenter and chunker the extractors run and reports what survived. That is what makes the
numbers comparable across runs and safe to produce for anything.

```bash
sec verify fixtures                                  # the committed corpus --fixture accepts
sec verify parse    --fixture s1_1849470_000110465921035696.htm
sec verify sections --file ./some-filing.htm
sec verify chunks   --cik 1849470 0001104659-21-035696
sec verify all      --fixture <name> --out ./trace   # full artifacts to disk
```

The fixture and file forms need no configured database. The accession form does — it reads
`filings.primary_doc`, then the on-disk fetch cache, and only downloads with `--fetch`.

## What each stage answers

| Stage      | Question                                                        | Artifact                                                                                                       |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `parse`    | How much of the filing's visible text survived the HTML parser? | `parse.json` — every block with its source span, every de-paginated block with its reason, the coverage report |
| `sections` | Which S-1 targets resolved, how big, and what did they swallow? | `sections.json`                                                                                                |
| `chunks`   | How would the risk-factor section be split for extraction?      | `chunks.json`                                                                                                  |

## Source spans

Every `EdgarBlock` carries a half-open `[start, end)` span of the **original filing HTML**
(`src/sec/html/types.ts`). This is the only link from anything downstream back to the source.

`DocumentNode.range` is **not** that link, despite looking like it. `parseToBlocks` sets it
to `0,0` and `buildDocumentTree` then overwrites it with a running character count over
concatenated node `text` — its own JSDoc says "exact source offsets are not preserved". The
result indexes neither the HTML, nor the rendered markdown, nor a section's own text: on
`s1_1848507` the Prospectus Summary reports a span of 126,594 against a `Section.text` of
126,895, the difference being the `"\n\n"` that `renderChildren` inserts and the counter does
not. `DocumentTreeSegmenter` publishes those numbers on every `Section` regardless, so treat
`Section.startOffset`/`endOffset` as ordering information and nothing more.

Spans ride on `EdgarBlock` precisely so the document tree is untouched: `buildDocument`
ignores them, and the golden corpus renders identically with and without the trace
(`sourceSpans.test.ts` asserts it).

A block parse5 could not locate — a synthesized `<tbody>` or `<body>` — would carry a
zero-width span at the position reached so far rather than a guess, so a coverage number can
never credit the parser for bytes it cannot account for. Measured over 8,116 blocks in 12
filings, no block needed that fallback and none arrived out of order.

## The coverage number

Coverage is the fraction of the filing's **content characters** that reached a block the
parser emitted. Four outcomes, and only the third is a defect:

- **emitted** — the text is in a surviving block's text;
- **de-paginated** — it reached a block the de-paginator then removed, reported by reason
  (`repeated-furniture`, `page-number`, `near-page-break`);
- **lost** — neither, with no record;
- **ignored** — the run carries no letter or digit (a rule of underscores, a cell of
  zero-width spaces, a lone bullet) and is excluded from the measure entirely.

**Ignored runs are excluded, not counted as loss.** The comparison is made on alphanumerics,
so a run with none can never be matched and would be reported lost forever however well the
parser did. They are 22.4% of all runs across the committed corpus and 65,304 characters — and
once the colspan defect below was fixed, they were _precisely the whole_ of what the measure
still called lost. They are counted and reported (`ignoredRuns` / `ignoredChars`) rather than
dropped silently, so the denominator stays auditable.

A lost run is reported with the innermost block whose _span_ contains it, because the two
cases have different fixes: a run inside a block is text the block was built from and then
failed to carry (a cell dropped from a table), while a run inside nothing was never reached
by the walk.

**Do not measure coverage by asking whether a run falls inside some block's span.** Block
spans nest — a table's span covers its cells whether or not the table's text kept them — so
that question answers yes for every character in the filing. The first version of this
measurement did exactly that and reported 100.00% over 31.5M characters of the corpus, which
is why the check compares _content_ against the innermost containing block, on letters and
digits alone (the two sides differ by entity decoding, whitespace, and the pipes and padding
GFM rendering inserts).

`coverage.test.ts` asserts **`lostChars === 0`**, not a ratio. The ratio mixes content that
reached a block with content the de-paginator deliberately removed, so tuning the furniture
rules moves it while nothing is lost. Loss is the defect signal on its own, and it is zero
across all 44 committed fixtures — so the assertion is the property rather than a number
somebody has to maintain.

## Fixed: colspan two-column tables lost their value column

The first thing this measure found, and the reason it exists.

`extractTable` materializes colspan into the grid — a `colspan: 3` cell is placed in three
adjacent columns, and `columnCount` counts expanded columns, which is what `TableNodeSchema`
documents it as ("Columns after colspan expansion"). `renderMarkdown`'s `flattenRow` pushed
each cell's text `colspan` times **again** and truncated to `columnCount`, so a row of
`label(3) | spacer(3) | value(3)` rendered as the label six times with the value gone.

That is the layout filers use for **"The Offering"** — the section `offering-terms`,
`spac-unit-terms`, `sponsor-promote` and the lock-up extractor all read, so the loss landed on
trust amounts, unit structure, tickers and lock-up terms.

Fixed in `@workglow/knowledge-base`, shipped in **workglow 0.4.3**, by removing the second
expansion. Measured across this
repo's 44 committed fixtures: 1,577 of 11,679 tables render differently, 41 fixtures recover
text, **116,330 characters of disclosure come back**, and content loss goes from 116,330 to
**zero**.

Data extracted before that fix was extracted from tables missing their value column. Anything
sourced from an offering table wants re-extraction.

## Why the golden tests did not catch it

`parseEdgarHtml.golden.test.ts` is property-based: node-count thresholds, expected section-name
sets, and `MIN_SECTION_CHARS` floors. Its own comment states how the floors were set —
**"Floors are observed/2"** — so a section has to lose _more than half_ its body before any
floor trips, and the colspan defect took a fraction of that from most sections.

Worse, a floor generated from current output can only ever detect regressions from that
moment on; it cannot detect a defect that was already there when the baseline was taken. One
`Use of Proceeds` entry now sits 62x its floor, which is what a stale baseline looks like.

That is the gap the coverage measure closes: it compares the parser's output against the
**source document** rather than against a remembered version of itself.
