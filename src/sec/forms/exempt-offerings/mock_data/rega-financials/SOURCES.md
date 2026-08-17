# Reg A financial statement fixtures

Real, unmodified documents lifted from EDGAR full submissions by
`selectRegAReportDocument` — the `<TEXT>` body of the tagged member, byte for
byte what EDGAR serves at `…/<accession>/<filename>`.

| file | CIK | accession | form | EDGAR filename |
| --- | --- | --- | --- | --- |
| `1k-partii-1800055-000121390024095260.htm` | 1800055 | 0001213900-24-095260 | 1-K | `ea0219991-1k_caltier.htm` (`<TYPE>PART II`) |
| `1sa-1838432-000110465924104481.htm` | 1838432 | 0001104659-24-104481 | 1-SA | `tm2425224d1_1sa.htm` (`<TYPE>1-SA`) |

| `1k-cover-1800055-000121390024095260.sgml` | 1800055 | 0001213900-24-095260 | 1-K | `primary_doc.xml` (`<TYPE>1-K`), with its `<DOCUMENT>` envelope kept |

The cover is stored WITH its SGML envelope because the envelope is what is under
test: `selectRegACoverDocument` finds it by `<TYPE>`, and a bare XML body would
exercise none of that. Pairing it with the PART II file above reconstitutes the
two-document submission a 1-K really is, without committing a second copy of the
220KB report.

Chosen for coverage rather than size: both carry all three statements with two
periods each, the 1-SA heads its balance sheet with a two-row date header, and
both satisfy the accounting identity, so a column-mapping regression fails the
assertions rather than merely changing a number.

The 1-K entry is the point of the exercise — a 1-K's own `primary_doc.xml` has
no financial elements, so the annual report only exists in this separate
`PART II` document.
