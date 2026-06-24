# Merger-proxy (DEFM14A/PREM14A) fixtures

## `defm14a_sample.txt`

A **compact, hand-authored** DEFM14A full-submission fixture modeled on the real
EDGAR SGML structure (`<SEC-HEADER>` + a `<DOCUMENT>`/`<TYPE>DEFM14A`/`<TEXT>`
envelope wrapping the primary HTML). It contains realistic `The Business
Combination` and `PIPE Financing` section headings with body prose naming a
target and a PIPE amount.

It exists to exercise the **plumbing** of the merger-proxy path end to end —
`parseRegistrationSubmission` → `parseEdgarHtml` → `DocumentTreeSegmenter` →
section runner → `spac_merger_extraction` persistence → deal correlation → SPAC
rollup — under a **stubbed** structured-generation model (so the assertions do
not depend on a live LLM). It is **not** a verbatim EDGAR document and is not a
golden parser sample.

Refreshing this tree with trimmed **real** SPAC DEFM14A/PREM14A submissions (for a
golden parser/segmenter test against authentic prospectus HTML) is future work; a
real full submission is multiple megabytes, so any committed real sample must be
trimmed to the merger/PIPE sections while keeping valid SGML + HTML.
