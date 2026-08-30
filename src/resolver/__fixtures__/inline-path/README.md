# What the incremental path produced

Each file is the rows one scenario's incrementally-maintained tables held, recorded
from the path that maintained them before it was deleted. The rebuilds are asserted
against these, which is how the claim they were written to make — that recomputing
from stored observations reproduces what maintaining in place produced — keeps being
checked after the second half of that comparison no longer exists to run.

Canonical ids are minted fresh per run, so each distinct id is replaced by its rank
(`#0`, `#1`, …) assigned in the order the ids first appear once the rows are sorted
by every other compared column (`labelCanonicalIds`). What survives is the partition —
who shares an identity with whom — plus every other column exactly.

Columns a run legitimately re-stamps are excluded rather than recorded and skipped:
`created_at` everywhere, and the junctions' `first_seen_at` / `last_seen_at`, which the
incremental path wrote as a wall clock and the rebuild writes as the asserting filings'
dates. That difference is intended, and the tests assert the rebuilt meaning directly.

Regenerating these is not a routine operation and there is no capture mode to do it:
the path that produced them is gone, so a file here can only be re-derived from the
commit that recorded it.
