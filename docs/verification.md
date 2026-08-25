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

Coverage is the fraction of the filing's **visible text characters** that reached a block the
parser emitted. Three outcomes, and only the third is a defect:

- **emitted** — the text is in a surviving block's text;
- **de-paginated** — it reached a block the de-paginator then removed, reported by reason
  (`repeated-furniture`, `page-number`, `near-page-break`);
- **lost** — neither, with no record.

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

`coverage.test.ts` holds a per-fixture **floor**, never the measured value. The number exists
to go up; an equality assertion would fail on the fix rather than on the regression.

## Known: colspan two-column tables lose their value column

Corpus coverage is 99.423%, and nearly all of the shortfall is one defect.

`extractTable` materializes colspan into the grid — a `colspan: 3` cell is placed in three
adjacent columns, and `columnCount` counts expanded columns, which is what
`DocumentSchema` documents it as ("Columns after colspan expansion"). `renderMarkdown`'s
`flattenRow` then pushes each cell's text `colspan` times **again** and truncates to
`columnCount`. A row of `label(3) | spacer(3) | value(3)` therefore renders as the label six
times, with the value gone.

That is the layout filers use for **"The Offering"** — the section `offering-terms`,
`spac-unit-terms`, `sponsor-promote` and the lock-up extractor all read. 42 of the 44
committed fixtures lose table-contained text to it.

The fix is in `libs`, and it changes every rendered table — hence the golden fixtures, hence
what every extractor is handed, hence re-extraction. Treat it as a dataset decision.
