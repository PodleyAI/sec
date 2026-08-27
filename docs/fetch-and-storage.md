# Fetch layer, bulk downloads, and database setup

Reference for `src/task/fetch/`, the bulk-download tasks, and `db setup` / `db reset`.

---

## 1. `SecCachedFetchTask` and `response_type`

`SecCachedFetchTask` takes a domain key (a CIK, an accession, a date), not a URL, so it
builds the request in **`resolveFetchInput`** — the seam every dispatch path runs through.
Not `execute()`: `FetchUrlTask` is streamable, so `TaskRunner` always dispatches to
`executeStream` and a subclass `execute()` override is never invoked. The constructor
throws on one rather than letting the URL derivation be silently skipped.

`response_type` is `"stream" | "text" | "json" | "blob" | "arraybuffer"` and is required
upstream. A caller-supplied value is always honored, including `"stream"`; the URL-extension
guess (`guessResponseType`) decides only for a caller that stated nothing, and never yields
`"stream"` — materializing is the right default for a parser-facing fetch, and asking for
bytes-only is an explicit decision about who reads the result.

### `SecFetchFileOutputCache`

Implements `saveOutputStreamPort` — the capability probe the cache coordinator keys its
binary sinks on — writing to the same path `inputToFileName` yields for a materializing
fetch, with the same tmp-then-rename discipline, so a stream failing mid-body never renames
a truncated file into place. Two consequences:

- **The row save that follows the sink is skipped**, detected by `body` carrying a
  `CacheRef` (or `response_type` being `"stream"`). `saveByPolicy` runs after the streaming
  sink and targets the same path, so re-serializing would overwrite the committed bytes —
  with a re-encode for a materializing type, and with an **empty file** for `"stream"`.
- **An unrecognized `response_type` is a cache MISS**, not an empty hit. An
  `outputDeserializer` filling no field used to hand back `{}`, which `getOutput` reported
  as a hit holding nothing — read downstream as "the document was empty" rather than "no
  entry", so the fetch was skipped and the caller parsed nothing.

`inputToFileName` does not include `response_type`, so a `"stream"` fill and a later
`"text"` fetch of the same document address the **same** cache path. The streamed copy is
the more faithful of the two: `"text"` serializes a UTF-8 decode, lossy on invalid
sequences (`U+FFFD`), while `"stream"` writes the origin's bytes verbatim.

### Retries are queue claims, not a second HTTP path

`execute()` makes **one** HTTP attempt. A retryable failure throws `RetryableJobError` with
`retryDate` set; the worker's `rescheduleJob` moves the row back to PENDING (visible at
`retryDate`, else the limiter's next-available time) and `limiter.complete()` frees the
concurrency slot. The next HTTP is a fresh claim through the same composite — Concurrency +
EvenlySpaced + the cluster RateLimiter — exactly like a first attempt.

There is **no in-job retry loop, and re-adding one would reintroduce the bug it replaced.**
`ConcurrencyLimiter(SecFetchMaxConcurrent)` holds its token until the job is terminal, so a
retry issued from inside `execute()` re-fires while still holding that token, downstream of
every limiter: after a 10-minute cooldown the whole in-flight set woke in one tick and
renewed the ban. Going back through the queue is what makes each retry wait its turn at
`tryAcquire`. (The old `retrySpread()` jitter existed only to disperse that herd, and is
gone with it.)

### Retryable, but only before the first delivered byte

`SecFetchJob` classifies 429/5xx/DNS/connect and per-attempt timeouts as retryable, but
**only before the first byte reaches a stream receiver**. Past that point the receiver's
subscription outlives the attempt, so a re-issue starts again at byte 0 and concatenates a
second body onto the first with nothing marking the seam. Nearly every retryable condition
lands before any body byte, so the classification keeps its value. The ban is enforced
twice: upstream re-classifies a mid-body failure as a non-retryable `BODY_TRUNCATED`, and
`execute()` latches its own delivery flag because a per-attempt timeout arrives as a bare
abort that keeps its shape through that classification and would otherwise be wrapped as
retryable after the consumer already saw bytes.

### The per-attempt timeout measures time without progress

Not total elapsed time. As a wall-clock cap it covered the whole attempt, body included, so
whether a fetch succeeded was a function of file size and bandwidth rather than of the
connection being alive: at the 60s default neither a multi-GB `submissions.zip` nor a
~1.5 GB daily Feed tarball can finish, and the abort lands mid-body where the
post-delivery retry ban refuses to restart it. A steady trickle rearms the timer on every
delta; a body that goes silent still trips it; and a fetch that stalls before its first byte
keeps exactly the fixed window it always had.

---

## 2. EDGAR's rate-limit block renews itself

Exceeding EDGAR's 10 req/s serves an HTML interstitial ("Your request rate has exceeded the
SEC's maximum allowable requests per second… limited for 10 minutes") under **429 and, per
SEC's own guidance, 403**. Requests made **during** the time-out extend it, so a client that
keeps firing renews the ban. The block is IP-wide — a captured 429 shows an ordinary browser
on the same IP being refused mid-sweep.

The **429 path alone was sufficient** to sustain it: a 429 was already retryable and did arm
the cluster cooldown, but the cooldown was 60s against a 600-second penalty, and each of the
up-to-`SEC_FETCH_MAX_CONCURRENT` in-flight jobs then retried on its own ≤30s backoff from
inside the job — every one a fresh violation inside a live window. Captured 429s carry **no `Retry-After`** and an
empty reason phrase, so the cooldown policy is the only thing sizing the wait.

### The first trip is not a ban

EDGAR throttles the offending requests when a burst clears 10 req/s and escalates to the
~10-minute IP block only if the caller keeps pushing. A flat ten minutes on the first 429
stops the CLI dead over a condition a few seconds of quiet clears. `COOLDOWN_LADDER_MS`
(`5s → 60s → 600s`) probes instead: back off briefly, and conclude we are genuinely banned
only once a retry **after** that pause is blocked again. Three rungs reach the full penalty
after ~65s — each probe costs a round of requests, so more rungs are gentler on a false
alarm and worse on a true one.

Three properties the ladder depends on:

- **A fleet blocking at once is ONE trip.** Every in-flight job sees the same block, so
  escalating per caller would climb `SEC_FETCH_MAX_CONCURRENT` rungs on the first overshoot.
  A block arriving while the cooldown is still in force is that same trip: the caller gets
  the REMAINING time and the ladder does not move. Only a block surviving a completed
  cooldown is new evidence.
- **The quiet period that resets the ladder is anchored on the END of the last cooldown**,
  so waiting out a full ban is not itself counted as the clean run that earns a reset.
- **The cluster pause only ever moves FORWARD.** The rung is process state, the sentinel is
  cluster state, and the storage write is last-writer-wins.
  `signalSecFetchThrottle` reads the current next-available time first, skips the write when
  it is already later, and returns that longer remaining time so the job can set
  `RetryableJobError.retryDate` to the same instant — a shard re-firing early is the
  ban-renewing behavior, whichever shard's ladder set it. A
  `Retry-After: 0` is not a block: it climbs no rung and arms no window.

`translateEdgarBlockResponse` deliberately synthesizes **no** `Retry-After` — EDGAR's
ten-minute figure describes the escalated ban, not the first overshoot.

### Three fixes closing the loop

- **`translateEdgarBlockResponse`** (`edgarBlockResponse.ts`, installed onto SafeFetch by
  `getSecJobQueue`) re-labels the interstitial as the `429` it describes. It belongs at the
  transport seam because the status is the only thing the fetch layer carries forward —
  `buildHttpError` reads a `{message}` out of a JSON body and discards everything else, so an
  origin explaining itself in HTML loses its reason before any caller sees it. Narrow on
  purpose: sec.gov only, `403` only, body must match. The **other** 403 EDGAR serves (the
  "Undeclared Automated Tool" User-Agent rejection) shares a headline but not the rate
  sentence and must keep failing fast — no cooldown fixes a misconfigured `SEC_USER_AGENT`.
- **The cooldown is signalled before the retry decision, not after.** A block landing on a
  job's last attempt is the same evidence about the cluster as any other, and under a
  sustained block that is most of them.
- **A blocked job throws `RetryableJobError` with `retryDate` set to the applied cooldown**,
  rather than sleeping inside `execute()`. The cluster sentinel gates DISPATCH, and a job
  that already started never re-consults the limiter — so both the old backoff and a plain
  sleep put every in-flight request back on the wire inside the penalty window, holding
  their limiter tokens throughout. Throwing releases the slot and makes the retry a new
  claim.

### The two limits are independent, and both are needed

`SecFetchMaxPerSec` (default **4**, clamped 1–8) caps how many fetches may START each
second, cluster-wide. It does **not** cap how many are still running: the queue worker
dispatches each claimed job in the background and immediately loops for the next, and the
rate limiter's window is pruned by AGE rather than by completion, so a slot frees one second
after a fetch begins however long it takes. In-flight work is therefore `rate × latency` —
sub-second while EDGAR is healthy, but a slow spell serving multi-MB full-submission `.txt`
documents at 30s each admits hundreds of concurrent requests.

Each in-flight fetch holds roughly two file descriptors and the pool releases them only
after an idle period, so that pile-up is what exhausts the descriptor table — reliably on
macOS, whose default `ulimit -n` of 256 is crossed at ~128 concurrent fetches. It is not a
leak: at a fixed concurrency the count is flat and returns to baseline once the pool goes
idle. It is the unbounded PEAK that has to be capped, which is `SecFetchMaxConcurrent`
(default **4**, clamped 1–64).

The default 4 matches the rate cap so a process cannot hold more in flight than it may start
in a second, and at 4 starts/second the cap binds as soon as a fetch averages over one
second. Because retries go back through the queue, they cannot bypass either cap.

---

## 3. Accession-document bulk cache (Feed tarballs)

The forms pipeline reads each filing's document from an on-disk cache
(`<SEC_RAW_DATA_FOLDER>/accessiondocs/<0-padded cik>/<accession-no-dashes>-<fileName>`, see
`readCachedDoc` in `ProcessAccessionDocFormTask`) before falling back to the rate-limited
per-document fetch. Fetching every filing's document individually is millions of throttled
requests; `BootstrapAccessionDocsTask` (`src/task/bootstrap/`) instead pre-populates the
cache from EDGAR **daily Feed tarballs**
(`/Archives/edgar/Feed/YYYY/QTRn/YYYYMMDD.nc.tar.gz`) — one download per filing day.

Days fetched are exactly the distinct `filing_date` values of ingested `filings` (so
weekends/holidays are never requested), optionally bounded by an inclusive `[from, to]`.
`streamFeedTarball` (`feedTarball.ts`) decompresses and walks each tar in a single streaming
pass, buffering only wanted members — peak memory is one submission, not the ~1.5 GB
compressed day.

Each kept member is a `.nc` **dissemination** submission: its `<DOCUMENT>…<TEXT>` bodies are
byte-identical to the public per-document files, but its header is tagged SGML
(`<SUBMISSION>`/`<CIK>`/`<CONFORMED-NAME>`/`<ASSIGNED-SIC>`/`<FILING-DATE>`), **not** the
public `.txt`'s human-readable `<SEC-HEADER>` block. `parseSecHeader` reads both dialects.
Per form, each member writes:

- the verbatim `.nc` as the full-submission `.txt` for the forms `submissionFetchKind`
  names — the registration/prospectus family, Reg A annual reports, and every 8-K; and
- the primary document, sliced **losslessly** out of the submission SGML by exact
  `<FILENAME>` match (`extractPrimaryDocFromSubmission`; binary `<PDF>`/uuencoded members are
  skipped so the cache never holds a corrupt doc), for every other form.

Completed days are marked under `accessiondocs/.feed-done/`, so a re-run resumes; `--force`
re-downloads and overwrites. A day with no Feed archive yet (recent dates → 404) is warned
and left unmarked. A day whose download or extraction **throws** is counted in `failed` with
a short reason and also left unmarked — a range can be thousands of days, and the ones
already extracted are worth keeping. Backend-dispatched day/filing queries
(`feedFilings.ts`) go through `resolveSqlBackend`.

> ⚠️ A full-history pull is roughly tens of TB decompressed, back-loaded onto recent years.
> Bound it with `--from`/`--to`.

```bash
sec bootstrap download-docs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--force]
sec bootstrap --download-docs [--docs-from YYYY-MM-DD] [--docs-to YYYY-MM-DD]
```

### The two bulk downloads run on the task framework

The Feed tarball and the bulk archives (`submissions.zip`, `companyfacts.zip`) used to call
raw `fetch()` — the only way to avoid materializing a multi-GB body. Each is now a two-node
subgraph, so the largest downloads keep the memory ceiling AND get back SafeFetch's
redirect/SSRF checks, the SEC rate limiter, `SecFetchJob`'s retry/backoff, and the 429
cluster-throttle signal:

```
SecFetchTask { response_type: "stream" } --body--> FeedTarballExtractTask   (a day)
SecFetchTask { response_type: "stream" } --body--> ArchiveToFileTask        (an archive)
```

Three load-bearing properties:

- **The run sets `noAccumulation`**, and it is not a tuning knob. Without it
  `awaitStreamInputs` drains the edge to a value before the sink starts, and that value IS
  the ~1.5 GB day. The edge must also name `body` explicitly and have a single consumer, or
  the passthrough check declines. `FeedTarballExtractTask.test.ts` parks the producer before
  its final chunk and requires the sink to have already written — it fails outright with the
  flag off.
- **`byteIterableFromEvents` turns an in-stream `error` event into a throw**, never a clean
  end. On a clean end gunzip is handed a truncated archive, the walk loop finishes normally,
  and the day is marked done holding half its documents — silent, permanent loss. It is an
  async generator rather than a `ReadableStream` because an errored WHATWG stream wrapped
  through `Readable.fromWeb` does not reliably reject under Bun, and the truncated-archive
  case hung instead of failing.
- **`ArchiveToFileTask` opens its tmp file lazily, on the first byte.** That is what makes a
  `304 Not Modified` safe end to end: no body, no stream, nothing opened, and the extracted
  tree the conditional request just certified as current is untouched. Opening up front would
  truncate it to zero. The other reason a port can carry no stream — a `body` that arrived as
  a VALUE — is the opposite verdict and throws, since a materialized edge is the entire cost
  this replaced.

`Content-Length` verification is not reimplemented here: `FetchUrlTask` asserts the
advertised length at end of stream. ETag/Last-Modified marker bookkeeping stays in
`BootstrapDownloadTask` — that is sec's own state, not the fetch's.

### Streaming to fill a cache

`sec spac download` (see `docs/spac.md`) fetches with `response_type: "stream"` **and**
`shouldAccumulate: false`. The flag is what makes `"stream"` mean what it says: the cache
sink receives every chunk without it, but `StreamProcessor` also tees each `binary-delta`
into an accumulator and materializes the whole document at finish — so a command whose
entire point is not to hold the document held a full copy of every filing in flight. The
relaxation that skips the tee (`canStreamBinaryToCache`) is computed only for a task the
GRAPH schedules, which is why the two bulk downloads get it from `noAccumulation` and an
owned child does not. Measured on a 128 MiB body, the finish event carried the whole thing
and peak off-heap memory ran ~4x the document.

---

## 4. SQLite initialization

`src/sec.ts` invokes **`Sqlite.init()`** when the installed `workglow` package defines it
(`typeof Sqlite.init === "function"`), so newer releases load the SQLite binding before
`getDb()` opens a database. Older versions without `init` skip this step.

`getDb()` is SQLite-only and throws under any other backend — see the cross-cutting rules in
`CLAUDE.md`.

---

## 5. `db setup` and `db reset`

### Extension seams

- **`registerDatabaseExtension`** (`src/config/databaseExtensions.ts`) — repo tokens
  registered here are created/dropped by `setupAllDatabases` / `resetAllDatabases` after the
  built-in SEC tables, so a superset's tables are managed by the same commands. `db setup`
  also calls `registerSecResolvers()` so resolver component-version rows seed even on the
  `init` path that skips the CLI preAction hook.
- **`registerDbStatsTables`** (`src/cli/queries/DbStatus.ts`) is the reporting half: a
  superset's tables are counted by `db stats` alongside sec's own. A registered table the
  database has not created reports `n/a` (with a "run `db setup`?" hint) rather than failing
  the whole report; only a missing relation degrades, every other error still throws.

### Row counts on Postgres are estimates by default

`db status` / `db stats` read `pg_stat_user_tables.n_live_tup` rather than scanning, and
that statistic is refreshed by ANALYZE/autovacuum, so it lags recent writes. The report says
so (`Rows (est.)`, a per-row `(est.)` marker, a footer pointing at `--exact`, and an
`estimated` field in `--format json`). Two things the query gets right:

- The relation name is **schema-qualified to `current_schema()`** (still fully
  parameterized). Unqualified, it would report another schema's count under sec's table name.
- **A zero estimate falls back to the exact count.** `n_live_tup` is 0 until the first
  ANALYZE, so right after a bulk load of ~1M `cik_names` the estimate reads 0 —
  `db status` printed `Entities: 0 / Filings: 0` under a column labelled "Rows". Zero now
  means "no statistics yet"; a genuinely empty table pays one cheap `COUNT(*)`.

### Three schema catch-up passes

`db setup` finishes with these, in order, all after the extension loop.

**1. Add missing columns** (`addMissingColumns.ts` — a pure `planMissingColumns` plus a thin
executor per backend). `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table and
`createStorage` declares no `tabularMigrations`, so a column added to a schema after a
database was created never appears in it. Every write goes through `putBulk` with the full
row, so the first write after the schema change fails outright —
`spac_candidate.signal_filed_sic_6770` broke `sec sync spacs` on every pre-existing database
that way. It runs before the alignment pass so a freshly-added column is eligible for
widening in the same `db setup`, and it subsumes the hand-written `spac.current_trust_*`
migration that used to sit beside it. `backfillExtractorRunsOutcome` stays hand-rolled — it
seeds `outcome` from `success`, which no generic pass can express.

Two rails: only **nullable** columns are planned (SQLite rejects `ADD COLUMN NOT NULL`
without a default, and there is no honest default for a signal nobody has computed), and an
**unmappable declared type is skipped with a warning, never guessed** — a missing column
fails loudly on the next write, whereas a column created at the wrong type is accepted and
mismatches silently. Non-goals, all deliberate: NOT NULL columns, type changes, drops,
renames, backfills. `schemaTypeMirror.sqlite.test.ts` creates every registered table on real
SQLite and requires the JSON-Schema → DDL mirror to have predicted each emitted type; a
column the mirror declines must be in a short explicit allowlist there (today:
`investment_offerings.exemptions`, `rega_offerings.securities_offered_type`,
`underwriter_link.role_detail`).

**2. Align column types** (`alignPostgresColumnTypes`). The declarative migration op set has
no `alterColumn`, so a database created before a column was widened or relaxed would keep the
old shape forever and keep rejecting real EDGAR values. The pass reads `information_schema`
and issues only one-directional `ALTER TABLE`s — widen a `varchar` (up to unbounded `text`),
drop a `NOT NULL` — which makes it idempotent. Postgres only; SQLite emits TEXT, and its one
NOT NULL relaxation needs the rename/recreate rebuild in `AddressRegionNullableMigration`.
A relaxation with no such migration — `filings.primary_doc` — therefore reaches Postgres on
the next `db setup` and a pre-existing SQLite database not at all. That is a widening, so an
old SQLite file keeps exactly today's behavior rather than breaking; only new databases gain
the ability to store a null `primary_doc`.

> ⚠️ Widening a `varchar` is binary-coercible so the heap is not rewritten, but every index
> on the column — including the unique index backing a primary key — is rebuilt under an
> ACCESS EXCLUSIVE lock. On a large deployment, run `db setup` in a maintenance window.

A **type** change on a column a view reads is skipped with a warning naming the view and the
exact DDL, rather than failing the whole setup; a `DROP NOT NULL` is never view-gated,
because Postgres does not refuse it.

**3. Drop stale CHECK bounds** (`dropStaleCheckConstraints`). The storage layer emits a
`CHECK (col >= 0)` for any numeric column declared `minimum: 0`, and neither pass above
touches a constraint — so relaxing that bound in a schema fixed every FRESH database and no
existing one, forever. This pass reads `pg_constraint` and drops the ones the schema no
longer declares.

What made it worth its own pass is the failure mode, which is not a clean rejection.
`crowdfunding_reports` writes its eighteen financial disclosures one row at a time in
declaration order, with the four negative-capable ones (`netIncome` / `taxPaid`, both fiscal
years) LAST — so a loss-making Reg CF issuer committed its parent row, stored a clean
fifteen-row prefix, and dropped exactly the fields a reader wants. The row count looked
plausible and nothing downstream could tell.

Its one safety rail is a literal shape match: only `CHECK ((col >= 0))` on a single column
the schema still declares, modulo the `(0)::numeric` cast Postgres renders for a numeric
column. A hand-written multi-part check, a multi-column check, or a bound on a column sec's
schema knows nothing about all fail to match and are left standing — the pass removes what
the storage layer stopped declaring and has no claim on anything else. Each drop is warned,
because unlike every other statement `db setup` issues it removes a guarantee rather than
adding one.

Postgres-only, for the same reason as the alignment pass: SQLite's CHECKs are inline in the
`CREATE TABLE` and removing one needs the rename/recreate/copy rebuild
(`AddressRegionNullableMigration` is the pattern).

`AddressRegionNullableMigration` is the pattern for relaxing a NOT NULL on SQLite, where no
`ALTER` can do it: rename aside, recreate at the current schema, copy back, all inside one
`BEGIN IMMEDIATE`. It covers **two** columns (`NULLABLE_COLUMNS`) rather than the one its
name records, and keeps its `addresses__legacy_region` scratch-table name so a database
stranded mid-rebuild by an older build is still found by the resume probe.

### `db reset`

Drops only what sec owns: every table built through `createStorage` (recorded in
`src/config/tableRegistry.ts`, supersets included), the `current_canonical_*` views, and the
Postgres rate-limiter tables. The rate-limiter names are **derived**, not literals:
`PostgresRateLimiterStorage` names its tables after its prefix columns, so
`setupSecFetchRateLimiter` and the reset both read one configuration
(`SecFetchRateLimiterOptions` / `secFetchRateLimiterTableNames`,
`src/task/fetch/secFetchRateLimiterConfig.ts`) — sharding the fetch budget by a prefix
column renames the tables on both sides at once instead of silently orphaning them
(`resetAllDatabases.test.ts` pins the derivation against the installed storage's own
migration DDL).

Tables sec does not own are left in place and named in a warning. `--cascade` drops dependent
objects; `--drop-schema` restores the whole-schema drop (Postgres only, destroys unowned
objects too). A drop blocked by a dependent object raises an error naming the table,
Postgres's DETAIL, and both flags. On Postgres all drops run in one transaction, so a blocked
drop rolls the earlier ones back rather than leaving a half-dropped database.

**`_storage_migrations` is not dropped.** It is `@workglow/storage`'s applied-version ledger
— one fixed-name table every package built on the library records into — so dropping it would
take a co-tenant's rows with it. It is left standing and reported like any other unowned
table. Its rows are still scoped: the reset issues a
`DELETE ... WHERE component = ANY(...)` over the components sec's own setup records under,
read back from the storage that writes them (`secFetchRateLimiterLedgerComponents`). That
delete is **mandatory, not tidy** — a
runner skips a `(component, version)` it finds recorded, so a row outliving the table its
migration created would stop `db setup` from ever recreating it. Today that set is exactly
the Postgres rate limiter's. `--drop-schema` still takes the ledger along with everything
else.

---

## 6. Company facts outcome tracking

`processed_facts` rows carry `reason_code` / `detail` / `attempts`. A companyfacts 404 (the
entity has no XBRL data — most filer CIKs) is recorded as a _successful_ `NO_XBRL_FACTS`
outcome and never retried. `FETCH_ERROR` (transient), `PARSE_ERROR` (code-fixable) and
`STORE_ERROR` rows are failures; `attempts` counts consecutive failures and resets on
success.

```bash
sec sync facts --retry-failed
```
