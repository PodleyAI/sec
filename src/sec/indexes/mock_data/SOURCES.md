# EDGAR master index fixtures

Fixtures for the daily and quarterly EDGAR **master index** feeds, exercised by
`FetchDailyIndexTask.test.ts`, `FetchQuarterlyIndexTask.test.ts`, and the
hermetic `../masterIndexFixtures.test.ts`.

| File | Feed | Source URL | Rows | State |
|------|------|------------|------|-------|
| `2024-01-01.master.idx` | daily | `/Archives/edgar/daily-index/2024/QTR1/master.20240101.idx` | — | Verbatim EDGAR **error body** (New Year's Day — no index published) |
| `2024-01-02.master.idx` | daily | `/Archives/edgar/daily-index/2024/QTR1/master.20240102.idx` | 5,531 | Verbatim |
| `2025-04-18.master.idx` | daily | `/Archives/edgar/daily-index/2025/QTR2/master.20250418.idx` | 2,502 | Verbatim |
| `2025-QTR1.master.idx` | quarterly | `/Archives/edgar/full-index/2025/QTR1/master.idx` | 2,500 of 337,842 | **Trimmed slice** |
| `2025-QTR2.master.idx` | quarterly | `/Archives/edgar/full-index/2025/QTR2/master.idx` | 2,500 of 210,866 | **Trimmed slice** |

## Why the quarterly fixtures are trimmed

A full quarter's master index is ~30 MB of highly repetitive pipe-delimited
text. The two quarterly files alone were 49 MB of working tree and ~6.9 MB of a
12 MB git pack — more than the entire committed S-1 prospectus corpus — while
the tests that read them only assert that the parse yields more than 100
distinct CIKs.

Each is now an evenly-spaced sample of 20 contiguous 125-row blocks drawn from
across the whole quarter (~220 KB each). Blocks rather than a head or a stride
sample, because the properties under test are positional:

- contiguous rows keep a CIK repeating across rows with different `Date Filed`
  values, which is what exercises the quarterly parser's keep-the-latest-date-
  per-CIK dedupe;
- spreading blocks across the file preserves the full date range and the
  form-type mix, instead of only the alphabetically first filers.

The header block through the `---------` separator (the marker both tasks scan
for) is copied verbatim, so each file is still a well-formed master index.

The daily fixtures are left verbatim: they are a few hundred KB, and a real
whole-day feed is a meaningful unit.

## Regenerating

Re-download the desired index from the URL above into this directory, then
re-trim (the script defaults to every `YYYY-QTRn.master.idx` here):

```sh
bun scripts/trimIndexFixtures.ts --check      # report what would change
bun scripts/trimIndexFixtures.ts              # rewrite in place
bun scripts/trimIndexFixtures.ts --rows 4000 --blocks 30
```

The script refuses to write a slice with 100 or fewer distinct CIKs, or one
small enough to be mistaken for the sub-1 KB error fixture.
`../masterIndexFixtures.test.ts` re-checks those invariants in CI, since the two
task tests are skipped under Node/vitest.
