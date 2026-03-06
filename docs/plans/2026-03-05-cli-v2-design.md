# @workglow/sec CLI v2 Design

A redesign of the SEC EDGAR CLI focused on ergonomics: guided workflows, logical command grouping, full query support, and rich interactive output.

## Design Goals

- **Three-command happy path:** `init` -> `bootstrap` -> `sync` covers 90% of use cases
- **Progressive disclosure:** simple pipelines for most users, granular commands for power users
- **Exploration-first queries:** search entities, filings, offerings, people directly from the CLI
- **Rich feedback:** progress bars, spinners, colored tables when interactive; structured output when piped
- **Scriptable:** `--json` flag, proper exit codes, stderr for errors

---

## 1. Command Hierarchy

```
sec [--json] [--verbose] [--dry-run] [--no-color] [--concurrency <n>] <command>
```

### 1.1 First-Run

```
sec init
```

Interactive wizard:
1. Choose database type (SQLite or PostgreSQL)
2. Configure database location/connection
3. Configure raw data folder
4. Write `.env.local`
5. Create directories
6. Run `db setup`

Detects existing `.env.local` and warns before overwriting. PostgreSQL path prompts for connection string or individual parameters. Non-zero exit if any step fails.

### 1.2 Pipeline Commands

#### `sec bootstrap`

Runs the full initial load pipeline:

| Phase | Description |
|-------|-------------|
| 1. Download | `submissions.zip`, `companyfacts.zip`, `cik-lookup-data.txt` |
| 2. Ingest | CIK names, submissions, company facts |
| 3. Process forms | Form D, Form C, Form 1-A |

Flags:
- `--skip-download` — skip phase 1 (use pre-downloaded files)
- `--skip-ingest` — skip phase 2
- `--skip-forms` — skip phase 3

Resumes automatically — skips already-processed CIKs. Graceful Ctrl+C saves progress.

#### `sec sync`

Smart incremental update — the daily command:

1. Fetches daily index
2. Updates stale submissions
3. Updates stale company facts
4. Processes new form filings

Flags:
- `--forms D,C,1-A` — limit form processing to specific types

If bootstrap hasn't been run, prints: `Database is empty. Run 'sec bootstrap' first.`

Idempotent — safe to run multiple times per day.

### 1.3 Bootstrap (Granular)

```
sec bootstrap download <type>       # submissions | facts | ciks | all
sec bootstrap ingest [domain]       # submissions | facts | cik-names | all (default)
```

### 1.4 Update (Granular)

```
sec update submissions [--concurrency <n>]
sec update facts [--concurrency <n>]
sec update forms <types> [--concurrency <n>]    # comma-separated: D,C,1-A
```

### 1.5 Fetch (Single Entity)

Ad-hoc commands for pulling data for one specific entity:

```
sec fetch submissions <cik>
sec fetch facts <cik>
sec fetch form <cik> <form> [accession]
sec fetch doc <accession> [filename]
```

Works whether or not bootstrap has been run. Respects SEC rate limits (10 req/s with exponential backoff).

### 1.6 Query

All query commands support `--format table|csv|json` (default: `table`), `--limit <n>` (default: 25), `--offset <n>`, and `--sort <field>`.

#### `sec query entities [search]`

Search and list SEC-registered entities.

| Option | Description |
|--------|-------------|
| `--cik <cik>` | Exact CIK lookup (shows full detail view) |
| `--sic <code>` | Filter by SIC code |
| `--state <state>` | Filter by state of incorporation |

Free-text `[search]` matches against entity name. Filters are combinable.

Single-entity detail view when `--cik` returns one result: shows full entity metadata, tickers, addresses, phones, filing count, and fact count.

#### `sec query filings [search]`

Search filing records.

| Option | Description |
|--------|-------------|
| `--cik <cik>` | Filter by entity |
| `--form <type>` | Filter by form type |
| `--after <date>` | Filed on or after date |
| `--before <date>` | Filed on or before date |

Free-text `[search]` matches against primary doc description.

#### `sec query offerings [search]`

Search Form D investment offerings.

| Option | Description |
|--------|-------------|
| `--cik <cik>` | Filter by issuer |
| `--industry <group>` | Filter by industry group |
| `--exemption <type>` | Filter by federal exemption |
| `--after <date>` | First sale on or after date |
| `--before <date>` | First sale on or before date |

#### `sec query crowdfunding [search]`

Search Form C crowdfunding offerings.

| Option | Description |
|--------|-------------|
| `--cik <cik>` | Filter by issuer |
| `--portal <name>` | Filter by funding portal |
| `--after <date>` | Filed on or after date |
| `--before <date>` | Filed on or before date |

#### `sec query facts <cik>`

XBRL financial facts for a specific company.

| Option | Description |
|--------|-------------|
| `--name <fact-name>` | Filter by fact name |
| `--taxonomy <group>` | Filter by taxonomy (us-gaap, dei, etc.) |
| `--year <fy>` | Filter by fiscal year |

#### `sec query persons [search]`

Search people extracted from form filings.

| Option | Description |
|--------|-------------|
| `--cik <cik>` | Filter by related entity |
| `--role <role>` | Filter by role (director, officer, promoter) |

### 1.7 Database Management

```
sec db status       # summary: db size, data freshness, staleness counts, last sync
sec db stats        # per-table row counts and sizes
sec db setup        # create/migrate tables (called automatically by init)
sec db reset        # drop and recreate (requires --confirm or interactive prompt)
```

---

## 2. Output Behavior

### 2.1 TTY Detection

When stdout is a TTY:
- Progress bars, spinners, colored tables with box drawing
- Interactive prompts (init, db reset)

When piped or not a TTY:
- No spinners or progress bars
- Plain text tables
- Prompts become errors: `Error: --confirm required when not interactive`

### 2.2 Global Flag Interactions

| Flags | stdout | stderr |
|-------|--------|--------|
| (none) | Rich output | Errors only |
| `--json` | Structured JSON | Nothing |
| `--verbose` | Rich output with detail | Nothing |
| `--json --verbose` | Structured JSON | Verbose logs |

### 2.3 Query Output Formats

**Table** (default): Auto-sizes to terminal width, truncates long fields with `...`.

**JSON**: Array of objects.

**CSV**: Header row + data rows, proper quoting.

### 2.4 Pagination

All list queries show total count in footer:
```
Showing 1-25 of 1,247 results (use --offset 25 for next page)
```

---

## 3. Error Handling

### 3.1 Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (bad input, network failure, database error) |
| 2 | Partial failure (some items in batch failed, others succeeded) |

### 3.2 Error Output

Errors always go to stderr.

Normal mode:
```
x Failed to fetch submissions for CIK 1318605: HTTP 429 Too Many Requests
  3 of 328 CIKs failed. Passing results were saved.
  Re-run 'sec sync' to retry failed items.
```

JSON mode:
```json
{ "error": "Failed to fetch submissions", "cik": 1318605, "cause": "HTTP 429 Too Many Requests" }
```

### 3.3 Ctrl+C Handling

Long-running commands handle SIGINT gracefully:
1. Finish the current item in progress
2. Save all completed work
3. Print summary of progress
4. Exit with code 2

---

## 4. Command Migration from v1

| v1 Command | v2 Equivalent |
|------------|---------------|
| `setup-db` | `sec db setup` (or automatic via `sec init`) |
| `bootstrap-download <type>` | `sec bootstrap download <type>` |
| `bootstrap-all-cik-names` | `sec bootstrap ingest cik-names` |
| `bootstrap-cik-last-update` | Absorbed into `sec bootstrap` and `sec sync` |
| `bootstrap-submissions` | `sec bootstrap ingest submissions` |
| `bootstrap-company-facts` | `sec bootstrap ingest facts` |
| `submissions <cik>` | `sec fetch submissions <cik>` |
| `company-facts <cik>` | `sec fetch facts <cik>` |
| `daily-index [date]` | Absorbed into `sec sync` |
| `form <cik> <form> [docid]` | `sec fetch form <cik> <form> [accession]` |
| `doc <docid> [fileName]` | `sec fetch doc <accession> [filename]` |
| `update-all-submissions` | `sec update submissions` |
| `update-all-company-facts` | `sec update facts` |
| `update-all-forms <form>` | `sec update forms <types>` |
| _(new)_ | `sec init` |
| _(new)_ | `sec bootstrap` (full pipeline) |
| _(new)_ | `sec sync` |
| _(new)_ | `sec query *` |
| _(new)_ | `sec db status`, `sec db stats`, `sec db reset` |
