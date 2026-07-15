# EDGAR priced-prospectus (424) fixtures

Real 424B1/424B4 **priced-IPO prospectus** primary-doc HTML, exercised by
`Form_424.golden.test.ts`. Same primary-doc HTML shape as the S-1 fixtures under
`../s1/` — `Form_424.parse()` hands the converter the same body — but kept in a
separate directory so the S-1 discovery globs (`realSections.ts`,
`parseEdgarHtml.golden.test.ts`, `goldenS1Labels`) do **not** sweep priced
prospectuses into the S-1 management/section eval set. Filenames are
`424b4_<cik>_<accession-no-dashes>.htm`.

| File | CIK | Accession | Company | SIC | SPAC | Resolves (target sections) |
|------|-----|-----------|---------|-----|------|-----------------------------|
| `424b4_2114227_000121390026048413.htm` | 2114227 | 0001213900-26-048413 | Churchill Capital Corp XII | 6770 | ✅ | The Offering, Underwriting, Use of Proceeds — **priced companion** to `../s1/s1_2114227_*` (final deal: 36,000,000 units @ $10.00, Citigroup underwriter). Fee-prepaid under Rule 456(a): **no** inline XBRL / fee exhibit (untagged-body path) |

URL pattern: `https://www.sec.gov/Archives/edgar/data/<cik>/<accession-no-dashes>/<primary-doc>.htm`
