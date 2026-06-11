# XBRL parser fixtures

Real EDGAR documents exercising `src/sec/xbrl/` directly (distinct from the S-1
converter corpus in `src/sec/html/mock_data/s1/`, whose golden test asserts
full-prospectus structure that these small documents would fail).

| File                                   | CIK     | Accession            | What it is                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `exfee_2114227_000121390026039320.htm` | 2114227 | 0001213900-26-039320 | Churchill Capital Corp XII `EX-FILING FEES` exhibit — the filing-fee table as a standalone iXBRL document tagged against the `ffd` (Filing Fee Disclosure) taxonomy: 53 facts (25 numeric) incl. `ffd:TtlOfferingAmt`, `ffd:NetFeeAmt`, per-class `ffd:AmtSctiesRegd` rows, and `ix:hidden` submission metadata. Pinned by `parseXbrl.golden.test.ts`. |

The matching S-1 primary document (full `spac`/`dei` inline tagging) is committed
as `src/sec/html/mock_data/s1/s1_2114227_000121390026039320.htm`.

URL pattern: `https://www.sec.gov/Archives/edgar/data/<cik>/<accession-no-dashes>/<filename>`
