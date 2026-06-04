# EDGAR S-1 golden fixtures

A random sample of **real** SEC Form S-1 / S-1/A prospectus HTML, used by
`parseEdgarHtml.golden.test.ts` to exercise the converter against messy
real-world markup (synthetic unit tests cannot reproduce page-sized container
divs, running headers, inline-XBRL, legacy `<font>` styling, etc.).

Each file is the filing's **primary document HTML** as served from EDGAR's
`Archives/` tree (this is the body HTML `Form_S_1.parse()` hands the converter in
production). Filenames are `s1_<cik>_<accession-no-dashes>.htm`.

At least three fixtures are **SPACs** (blank-check companies, SIC **6770**), per
the testing requirement. A larger / fresher sample can be pulled on demand into a
gitignored cache via `sec fetch s1-fixtures` (see `src/task/fixtures/fetchS1Fixtures.ts`).

| File | CIK | Accession | Company | SIC | SPAC | Resolves (target sections) |
|------|-----|-----------|---------|-----|------|-----------------------------|
| `s1_1848507_000119312521066104.htm` | 1848507 | 0001193125-21-066104 | 1.12 Acquisition Corp | 6770 | ✅ | Management, Beneficial Ownership, Related Party |
| `s1_1849470_000110465921035696.htm` | 1849470 | 0001104659-21-035696 | 1Sharpe Acquisition Corp | 6770 | ✅ | Management, Beneficial Ownership, Related Party |
| `s1_1822912_000121390021001475.htm` | 1822912 | 0001213900-21-001475 | 26 Capital Acquisition Corp | 6770 | ✅ | Management, Beneficial Ownership, Related Party (5 stitched tables) |
| `s1_2030954_000149315226027129.htm` | 2030954 | 0001493152-26-027129 | TEN Holdings, Inc. | — | — | Beneficial Ownership |
| `s1_2087989_000143774926019444.htm` | 2087989 | 0001437749-26-019444 | Texas Precious Metals Trust | — | — | (none — atypical trust structure; 3 stitched tables) |
| `s1_1817004_000149315226027137.htm` | 1817004 | 0001493152-26-027137 | NEXTNRG, Inc. | — | — | (none — incorporation-by-reference S-1/A; exercises the `SECTION_NOT_FOUND` path) |

URL pattern: `https://www.sec.gov/Archives/edgar/data/<cik>/<accession-no-dashes>/<primary-doc>.htm`
