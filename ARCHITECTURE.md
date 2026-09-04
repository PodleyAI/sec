# Architecture

How a filing gets from EDGAR into the database, and what to change when you want
it to hold something else.

## The pipeline

Five stages, each a command and each resumable on its own. `sec update` runs them
in this order; `sec status` shows where each one stands.

```
  index         EDGAR's daily master.idx     ->  cik_last_update, daily_index_cursor
  submissions   data.sec.gov/submissions     ->  entities, entity_tickers, filings
  facts         data.sec.gov/api/xbrl        ->  company_facts
  documents     the filing's own HTML        ->  filing_document, filing_section, xbrl_fact
  adv           adviserinfo.sec.gov CSV zips ->  adv_adviser, adv_row
```

**Every stage resumes from state it already wrote**, which is what makes a
half-finished run recoverable rather than something to start over:

| Stage | What it anti-joins against |
| --- | --- |
| `index` | `daily_index_cursor.last_success` — the newest *completed* ET day applied |
| `submissions` | `processed_submissions` |
| `facts` | `processed_facts`, which records failures too (`--retry-failed`) |
| `documents` | `filing_document.converter_version` on the row marked `is_primary` |
| `adv` | the archive's period, which is the primary key's first column |

The documents anti-join is the subtle one. A submission stores one row per
document and the converter writes the **primary last**, so "has a row" would call
a filing done the moment its first exhibit landed. Keying on the primary means its
presence promises everything behind it is already stored.

## Fetching

Every request to EDGAR goes through one job queue with two independent limits:

- **rate** — how many requests may *start* per second, shared across processes
  through the queue's storage, so running four shards does not quadruple your
  footprint;
- **concurrency** — how many may be *in flight* at once, per process.

Both are needed. The rate limiter's reservations age out rather than being held to
completion, so on its own it admits `rate × latency` requests — a slow EDGAR
serving multi-megabyte documents puts hundreds in flight, and at roughly two file
descriptors each that exhausts the process's table. See `docs/fetch-and-storage.md`.

Retries re-enter through the queue rather than re-issuing inside the job, so they
cannot bypass either cap.

## Parsing a filing

`src/sec/html/` is the part of this repo that took the longest to get right.

A submission is a **directory**, not a file: the primary document plus the exhibits
filed with it. Only the full-submission `.txt` carries them all, along with the
`<TYPE>`/`<DESCRIPTION>`/`<FILENAME>` manifest that says what each one is, so that
is the first file tried for every form.

Each document then goes through:

1. **`parseToBlocks`** — cheerio over the HTML into styled blocks.
2. **`DePaginator`** — drops the page furniture EDGAR filings are full of: repeated
   headers, page numbers, the table of contents on every page of a printed
   prospectus. Whole pages of a long S-1 are page furniture.
3. **`HeadingDetector`** — decides which blocks are headings, from style, position
   and a vocabulary of the section names filings actually use.
4. **`TableExtractor`** — renders tables to markdown, including the two-column CSS
   tables filers use for cover pages.
5. **`splitDocumentSections`** — flattens the tree into one `filing_section` row per
   heading, which concatenate back to the document in `ordinal` order.

Every block keeps a **source span** into the original HTML, which is what makes
`sec read <accession> --trace` able to say how much of the filing's visible text
survived. That number is the parser's own regression test: a change that quietly
drops a section shows up as coverage falling.

Filings also carry **inline XBRL**, and the same pass reads it: `parseInlineXbrl`
over the document's HTML produces `xbrl_fact` rows for what the filer actually
tagged. Complementary to `company_facts` rather than a duplicate of it — the API
gives a normalized series, the document gives the as-filed value you can point at.

## Storage

Every table is declared **once**, as one entry in
`src/config/storageRegistry.ts`:

```ts
defineStorage({
  token: FILING_REPOSITORY_TOKEN,
  table: "filings",
  schema: FilingSchema,
  primaryKeyNames: FilingPrimaryKeyNames,
  indexes: ["cik", "form", "filing_date"],
})
```

`setupAllDatabases`, `resetAllDatabases`, `db stats` and the schema-alignment
passes all loop that list, so **adding a table is that entry and nothing else**.

`DefaultDI` builds each entry through `createStorage` (SQLite or Postgres from
`SEC_DB_TYPE`); `TestingDI` builds each as an in-memory storage, which is what
lets most tests run with no database at all.

Schemas are TypeBox. Each storage module exports the schema, its primary key
names, a DI token, and — where there is domain logic — a repo class.

### Adding a column

`db setup` adds any missing **nullable** column and widens or relaxes existing
Postgres types. A `NOT NULL` column is what it cannot do; give it a default, or
`db reset` in development.

### History and current state

The dataset's value is showing how filings change data over time alongside a
queryable current state:

- **Append-only tables** keyed by accession — `filing_section`, `xbrl_fact`,
  `company_facts` — are the time series and are never overwritten by a later
  filing.
- **Mutable rows** — `entities` — reflect the latest filing, and `entities_history`
  plus `change_log` version them so a point-in-time state stays reconstructable.

## Search

`sec index` turns stored sections back into a document tree, chunks and embeds it
through `@workglow/ai`'s standard knowledge-base strategy, and stores the vectors
in `kb_chunk` beside everything else. `sec ask` retrieves from there and answers
with citations naming the filing and linking the document.

The embedding model's width is a **schema fact**, not a preference: the vector
column is created at that width. Changing `SEC_EMBEDDING_MODEL` without
re-indexing gives you a store whose vectors mean nothing to the query.

## Adding a stage

A stage is a task plus a leaf:

1. Write the task under `src/task/<domain>/`, with a `static readonly title` —
   `taskTitles.test.ts` fails the build without one, because the title is what the
   progress UI labels the row with.
2. Register a leaf in `src/cli/sync/registerSecSyncLeaves.ts`: an `id`, an `order`,
   whether it belongs in `sec update`'s run, its own flags, and a `run`.
3. If it writes somewhere new, add the `defineStorage` entry.

Commands hold no business logic — work lives in tasks, presentation in the
command — and task inputs are passed through the constructor's `defaults`, never
the graph run-input, where an array can trigger fan-out semantics.

## Adding a form type

Form types are a **dictionary**, not parsers: one class per form giving its name,
description and the EDGAR symbols it covers.

```ts
// src/sec/forms/periodic-reports/Form_10K.ts
export class Form_10K extends Form {
  static readonly name = "Annual report";
  static readonly description = "...";
  static readonly forms = ["10-K", "10-K/A"] as const;
}
```

Add it to its category's `index.ts` and it appears in `ALL_FORMS_MAP`, which is
what titles a form in `sec show filings` and what the console's form picker offers.

To have a form's text converted as well, add its symbol to `CONVERTIBLE_FORMS` in
`src/task/document/selectFilingsToConvert.ts` and bump
`FILING_CONVERTER_VERSION` so already-converted filings are re-selected.
