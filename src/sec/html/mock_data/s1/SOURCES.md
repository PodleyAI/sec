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

URL pattern: `https://www.sec.gov/Archives/edgar/data/<cik>/<accession-no-dashes>/<primary-doc>.htm`

### Synthetic full-submission `.txt` fixtures

| File | CIK | Accession | Company | SIC | Type | Purpose |
|------|-----|-----------|---------|-----|------|---------|
| `drs_1848507_000119312521066104.txt` | 1848507 | 0001193125-21-066104 | Synthetic SPAC Acquisition Corp | 6770 | DRS (synthetic) | SGML-header parsing + DRS primary-doc selection + DRS dispatch path |
