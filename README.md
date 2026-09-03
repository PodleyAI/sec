# sec

A worked example of the [Workglow](https://github.com/workglow-dev/libs) libraries:
pull SEC EDGAR and Form ADV data into a local database, turn filings into readable
markdown, and ask questions about what they say.

It is an example, not a product. If you are looking for a private-markets data
pipeline, this is the layer underneath one.

## Ten minutes

```sh
bun install
bun run build

sec setup                     # writes .env.local, creates the tables
sec load download ciks        # the company list — 8 MB, about 30 seconds
sec get AAPL                  # one company: submissions, facts, documents
```

`sec get` takes a CIK, a ticker, or a name. If several companies match it shows
you which, rather than picking one.

Then read what it fetched:

```sh
sec status                                     # what is loaded, and what to run next
sec read 0000320193-24-000123 --list           # the documents in one filing
sec read 0000320193-24-000123 --section "risk" # one section, as markdown
sec show xbrl --cik 320193                     # the numbers the filer tagged
sec ask "how does Apple describe its supply chain risk?"
```

Bare `sec` runs `status`. Every command ends by suggesting the next one.

### Two things to know before you use `ask`

**It answers from filing prose, and cites what it read.** For a *number* — revenue,
assets, share count — use `sec show xbrl` (what the filer tagged in the document) or
`sec show facts` (the SEC's normalized series). A retrieval model quoting a sentence
about revenue is not a source for revenue.

**It works with no API key.** Embeddings run locally on CPU, and if no
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` is set the answer comes from
a small local model too. It is visibly worse than a cloud model, which is why every
answer says which one wrote it.

## The commands

| Command | What it does |
| --- | --- |
| `sec setup` | Configuration, then the tables |
| `sec status` | What is loaded, how stale, what to run next |
| `sec get <company>` | One company end to end |
| `sec update [stage]` | Bring what you have current — `index`, `submissions`, `facts`, `documents`, `adv` |
| `sec load download <what>` | Bulk backfill from the SEC's archives — states its size and time first |
| `sec show <what>` | `companies`, `filings`, `facts`, `xbrl`, `advisers` |
| `sec read <accession\|file>` | A filing as markdown; `--trace` measures what the parser did |
| `sec index` / `sec ask` | Embed filing sections, then answer from them |
| `sec db setup\|stats\|reset` | The escape hatches |
| `sec web` | A local console over all of the above |

The old names still work: `sync`, `bootstrap`, `query`, `init` are aliases.

There is a second binary, `sec-base`, which is the generic Workglow CLI — `task`,
`model`, `mcp`, `workflow`, `agent`, `web` — with this repo's tasks registered:

```sh
sec-base task list
sec-base task run QueryFilings --input-json '{"cik":320193}'
```

## What does the work

Each step is one Workglow package doing its job, and the point of the example is
that you can go read the seam.

| Step | Package | Where |
| --- | --- | --- |
| Every EDGAR request, rate-limited across processes | `@workglow/job-queue` | `src/task/fetch/` |
| Filings, facts, documents into SQLite or Postgres | `@workglow/storage`, `@workglow/sqlite`, `@workglow/postgres` | `src/config/storageRegistry.ts` |
| Each stage as a task, composed into runs | `@workglow/task-graph` | `src/task/` |
| Filing HTML into a document tree | `@workglow/knowledge-base` | `src/sec/html/`, `src/sec/document/` |
| Chunking, embedding, retrieval | `@workglow/ai` | `src/kb/`, `src/task/kb/` |
| Local and cloud model providers | `@workglow/huggingface-transformers`, `@workglow/anthropic`, … | `src/config/registerProviders.ts` |
| The CLI, its progress UI and web console | `@workglow/cli` | `src/cli/`, `src/web/` |

They arrive through the `workglow` meta package — `import { Task, KnowledgeBase } from "workglow"` — which is the "install one thing and go" path.

**The rate limiter is the piece most worth reading.** EDGAR meters by IP, so the
budget is shared across every process you run, and there are two separate limits
that both matter: how many requests may *start* per second, and how many may be *in
flight*. `docs/fetch-and-storage.md` explains why one without the other exhausts the
process's file descriptors.

## The data

Sixteen tables. `sec db stats` counts them all.

- **Companies** — `cik_names` (every filer's name), `entities` + `entities_history`,
  `entity_tickers`, `sic_code`
- **Filings** — `filings`, and `filing_document` / `filing_section` for the ones
  converted to markdown
- **Numbers** — `company_facts` (the companyfacts API's normalized series) and
  `xbrl_fact` (what the filer tagged in the document itself, with the same concept
  often in both)
- **Advisers** — `adv_adviser` for the columns people filter on, `adv_row` for every
  other Form ADV column as JSON
- **Bookkeeping** — `cik_last_update`, `daily_index_cursor`, `processed_submissions`,
  `processed_facts`, `change_log`
- **Search** — `kb_document`, `kb_chunk`

Every table is one `defineStorage` entry in `src/config/storageRegistry.ts`, and
`db setup` / `db reset` / `db stats` all loop that list. Adding a table is that entry
and nothing else.

## Working on it

```sh
bun run test          # vitest
bun run typecheck     # tsc --noEmit over src, scripts and tests
bun run lint          # oxlint + type-aware rules
bun run format        # oxfmt
```

Node 24 and Bun 1.4+. `node:sqlite` is what backs the SQLite storage, and it is
neither stable nor unflagged below those.

See `ARCHITECTURE.md` for the pipeline end to end, and `docs/fetch-and-storage.md`
for the fetch layer.
