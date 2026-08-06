# EDGAR registration-prospectus form fixtures (S-1 / DRS)

A curated set of fixtures for **registration-prospectus forms (S-1 / DRS)**, used
to exercise the SGML-header parser, primary-document selector, HTML converter, and
section segmenter against a range of real-world and synthetic inputs.

**Real EDGAR filings (`.htm`)** — primary document HTML as served from EDGAR's
`Archives/` tree; exercised by `parseEdgarHtml.golden.test.ts`. Each file is the
body HTML `Form_S_1.parse()` hands the converter in production. Filenames are
`s1_<cik>_<accession-no-dashes>.htm`.

At least three fixtures are **SPACs** (blank-check companies, SIC **6770**), per
the testing requirement. A larger / fresher sample can be pulled on demand into a
gitignored cache via `sec fetch s1-fixtures` (see `src/task/fixtures/fetchS1Fixtures.ts`).

**Synthetic full-submission fixtures (`.txt`)** — minimal SGML `.txt` files used
to exercise SGML-header parsing, primary-document selection, and DRS dispatch
without hitting the network. These are **NOT** real EDGAR captures.

| File | CIK | Accession | Company | SIC | SPAC | Resolves (target sections) |
|------|-----|-----------|---------|-----|------|-----------------------------|
| `s1_1848507_000119312521066104.htm` | 1848507 | 0001193125-21-066104 | 1.12 Acquisition Corp | 6770 | ✅ | Management, Beneficial Ownership, Related Party |
| `s1_1849470_000110465921035696.htm` | 1849470 | 0001104659-21-035696 | 1Sharpe Acquisition Corp | 6770 | ✅ | Management, Beneficial Ownership, Related Party |
| `s1_1822912_000121390021001475.htm` | 1822912 | 0001213900-21-001475 | 26 Capital Acquisition Corp | 6770 | ✅ | Management, Beneficial Ownership, Related Party (5 stitched tables) |
| `s1_2030954_000149315226027129.htm` | 2030954 | 0001493152-26-027129 | TEN Holdings, Inc. | — | — | Beneficial Ownership |
| `s1_2087989_000143774926019444.htm` | 2087989 | 0001437749-26-019444 | Texas Precious Metals Trust | — | — | (none — atypical trust structure; 3 stitched tables; cover-page-only iXBRL: 19 `ix:nonNumeric` dei facts) |
| `s1_2114227_000121390026039320.htm` | 2114227 | 0001213900-26-039320 | Churchill Capital Corp XII | 6770 | ✅ | Management, Beneficial Ownership, Related Party, The Offering, Underwriting, Use of Proceeds — **full iXBRL tagging** (216 `ix:nonFraction` + 44 `ix:nonNumeric`, 141 contexts, `spac`/`dei` taxonomies, continuations, signed values); also exercised by `parseXbrl.golden.test.ts` |
| `s1_1817004_000149315226027137.htm` | 1817004 | 0001493152-26-027137 | NEXTNRG, Inc. | — | — | (none — incorporation-by-reference S-1/A; exercises the `SECTION_NOT_FOUND` path) |
| `s1_1507957_000143774926010088.htm` | 1507957 | 0001437749-26-010088 | Ideal Power Inc. | 3674 | — | Management, Beneficial Ownership, Related Party, The Offering, Underwriting, Use of Proceeds, **Executive Compensation** — a real Item 402 Summary Compensation Table (2 named executive officers x 2 fiscal years, scaled-disclosure column set) under the `Compensation of Directors and Executive Officers` heading spelling, followed by a separate Director Compensation table the extractor must ignore |

No committed SPAC fixture carries a Summary Compensation Table — a blank-check
company has no compensation history and says so in one sentence — so the
operating-company IPO above is what pins the compensation section end to end.

URL pattern: `https://www.sec.gov/Archives/edgar/data/<cik>/<accession-no-dashes>/<primary-doc>.htm`

### Provenance is pinned in code

The exact source document and digest for every real `.htm` here (and under
`../424/`) live in `src/task/fixtures/goldenFixtureManifest.ts`, which records
each fixture's primary-document filename, the SHA-256 of the bytes EDGAR serves,
the capture transform, and the SHA-256 of the committed file. That makes the
corpus reproducible and auditable:

```sh
sec fetch golden-fixtures --verify   # re-fetch from EDGAR and compare; no writes
sec fetch golden-fixtures            # reproduce any missing/changed fixture
```

Most fixtures are stored **verbatim** as EDGAR serves them — which for several of
these means the dissemination SGML wrapper (`<DOCUMENT>`/`<TYPE>`/`<TEXT>`) is
part of the file. The one exception is recorded as `strip-sgml-wrapper` in the
manifest. `goldenFixtures.test.ts` re-hashes the committed files against the
manifest on every test run (no network), so editing a fixture in place fails
loudly instead of silently re-baselining the golden tests above.

### Synthetic full-submission `.txt` fixtures

| File | CIK | Accession | Company | SIC | Type | Purpose |
|------|-----|-----------|---------|-----|------|---------|
| `drs_1848507_000119312521066104.txt` | 1848507 | 0001193125-21-066104 | Synthetic SPAC Acquisition Corp | 6770 | DRS (synthetic) | SGML-header parsing + DRS primary-doc selection + DRS dispatch path |
