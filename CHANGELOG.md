# Changelog

## 0.0.26

### Bug Fixes

#### checkPackedContents

- update max unpacked bytes limit and add .map to forbidden suffixes

### Chores

- update release script and enhance PROCESS_CONFIDENCES type safety
- format

## 0.0.25

### Features

#### s1

- implement offering and sponsor promote text parsing functions
- parse SPAC warrant/rights fractions and sponsor promote tables
- parse SPAC offering price and unit count from markdown tables

#### fetch

- implement Retry-After cap in SecFetchJob
- let a sec fetch ask for a byte stream, and give the cache a sink

#### forms

- enhance Form 1-A processing and schema definitions
- add support for new Reg A offering events and forms
- enhance SEC STAFF ACTION and 20-F handling
- add support for new forms 1-SA, Form 1-U, and Form QUALIF

#### tests

- enhance handling of MODEL_INVALID_OUTPUT and MODEL_EMPTY in 8-K processing
- enhance Form 424 tests and processing logic for IPO handling
- add tests for equity class substance validation in Form 1-A
- add null fields to various schemas and test cases

#### ipo

- enhance ipoTrustAmount function to handle missing unit trust_per_unit

#### goldenS1Labels

- add Karman Line Acquisition Corp. management and executive compensation details

#### spac

- enhance classifyListingRemoval to recognize prior completed events
- implement issuer combination listing check for newcos
- introduce nonfatal filing handling for ownership forms
- sec spac download streams instead of materializing

#### model

- enhance model ID handling with fallback options

#### link-workglow-packages

- enhance local linking of workglow packages

#### bootstrap

- add quarterly index command and integrate CIK last update tracking
- the bulk archives download through SecFetchTask
- the Feed tarball downloads through SecFetchTask

#### classifyListingRemoval

- enhance classification logic for listing removals and add tests for completed status

### Bug Fixes

#### reg-a

- replace the literal NUL separator that made the file binary

#### spac

- bound the listing-removal completion inference to a recent proxy/vote
- stop a post-IPO 424 repricing the SPAC's IPO figures
- stop the download path materializing every filing it streams
- update withdrawal logic to account for later registrations
- order the unknown-floor allowance after the 20-F FPI-close check
- an unknown IPO floor no longer demotes a 25-NSE to deregistration

#### dead-letter

- stop treating MODEL_INVALID_OUTPUT as an expected negative

#### address

- store a null city rather than inventing one from the country

#### tests

- enhance Reg A report document selection logic

#### fetch

- say out loud when no fetch cache is installed
- time the per-attempt timeout by stall, not by total elapsed
- declare the real output schema, so a cached fetch can actually stream

### Refactors

- clarify default model handling and update related tests

#### exempt-offerings

- normalize company names in storage and tests

#### spac

- own the accession-doc fetch directly instead of wrapping it

### Performance

#### fetch

- answer a cached stream read without reading the file

#### spac

- one indexed pass over s1_classification; default resolve's version

### Style

- run prettier over the repo
- revert an incidental reformat of feedTarball

### Tests

#### RegAOfferingRepo

- add qualification and concurrent offering aggregates to test cases

#### submissions

- drive cik_last_update and the refresh filter through production code

#### reg-a

- make the array-typed securities_offered_type type-checked

### Documentation

- describe the streaming fetch layer and the two bulk downloads

#### extractor-ids

- put the QUALIF note back above QUALIF

#### claude

- correct the ipo_date gate and document the address re-key

### Build

- pin prettier, ignore golden fixtures, run format-check in CI

### Updated Dependencies

- `@workglow/cli`: 0.3.46
- `typebox`: 1.3.15
- `workglow`: 0.3.46
- `@types/pg`: ^8.23.1
- `vitest`: ^4.1.11

## 0.0.24

### Features

- add legal form handling for company names
- implement optionValue and csvOptionValue functions for improved CLI argument handling
- enhance risk factors extraction and improve title casing logic
- add SPAC-specific extractors and related-party handling in golden label tests
- enhance command exports and improve error handling in fetch commands

#### classifyListingRemoval

- implement classification logic for listing removals and add corresponding tests

#### extractor

- enhance dead-letter CLI commands and add tests for extractor filtering

#### schema

- normalize securities offered types and enhance RegAOfferingSchema
- introduce CrowdfundingHistorySchema tests and update maxLength constraints

#### spac

- add loi_date and target_description to spac_deal schema and tests
- add triageExtractors to ProcessSpacTimelineTask output
- implement current trust balance management for SPACs
- enhance Form 8-K processing with merger counterparty extraction and exhibit detail improvements
- enhance SPAC milestone event mapping and exhibit handling
- enhance deregistration handling and deal termination logic
- enhance formatSpacProcessSummary for dry-run functionality
- introduce temporary inventory script and enhance risk factors handling
- add spac download registration/8k/everything CLI
- download candidate registration and 8-K filings into accessiondocs
- add download helper for candidate form sets and cache paths

#### sec

- enhance Form 424 processing with ipoProceeds calculation and add tests
- introduce Form RW and process withdrawal functionality
- add ipoTrustAmount function and related tests for trust calculations
- re-normalizing resolve, alias suggester, and an as-filed SIC signal
- recover structureless filings, and stop a stale header SIC minting a SPAC
- enhance model ID handling for environment variables
- implement metadata-only parsing for Form 25/15 and integrate deregistration processing

#### resolver

- key families off the legal name, not the model's common name

#### company

- derive a family name from a company's legal name

#### eval

- score a mixed name column through the row's own entity kind
- run eval s1 sections through MapTask concurrency
- map candidate models per S-1 section
- add per-candidate S-1 eval MapTask worker
- add eval s1 --concurrency flag
- add eval s1 section concurrency default helper
- enhance print prompts with new document mode and extraction prompt estimation
- add --print-prompts schema mode
- add --dump-raw CLI flag and stderr dumps
- add stderr dump helpers for --dump-raw
- retain raw payloads in EvalS1Task when dumpRaw
- retain raw payloads in runUnitTermsEval when dumpRaw
- retain raw payloads in runExtractionEval when dumpRaw
- add captureEvalRaw for --dump-raw payloads
- add --print-prompts inspect-only dump to extract/s1/unit-terms
- add printEvalPrompts helper and resolveEvalFixtures

#### config

- update model pricing for Grok and DeepSeek models
- add list pricing functionality and tests for model pricing
- enhance model registration with optional inference provider support and pricing integration

#### model

- enhance EnsureModelDownloadedTask to support cloud model verification

### Bug Fixes

#### 1-A

- normalize blank equity class names to N/A instead of dropping the class

#### sec

- merge main, repair fallbacks narrowing, bump workglow to 0.3.44
- enhance error handling in S-1 extraction process
- three heading gaps found on 30 more SPAC registrations
- generalize the nested-section fallback, minus the summary
- recover an ownership table that follows the roster unheaded
- recover an offering table the filer bolds inside the summary
- a CIK that is already a known SPAC is never demoted
- do not demote a small blank check, and read the shell Item 401 heading
- normalizer and segmenter defects found on real SPAC registrations
- correct estimate reporting, unbounded prune, and silent partial extractions (#250)

#### fetch

- ban a timed-out retry once bytes reached a receiver
- resolve the SEC request through resolveFetchInput
- bound EDGAR fetches in flight, not just their start rate
- stop the job queue retaining every downloaded document

#### company

- drop the write-only locals in stripCompanyAllEndings
- strip a series marker mid-name, not only at the tail
- state the diacritic gap, and restore the family-key floor

#### rekey

- repair the Postgres schema pin and the 424 family-tier gap
- scope the truncate scripts, and make aliases restorable

#### tests

- correct expected length in listRegisteredComponents test

#### spac

- stop counting partial extractions as issuer failures
- let a completion outrank a deregistration, and order the forms sweep
- classify 8-K items from the pre-filing event prefix
- build the download worklist per chunk, not from every filing at once
- own and run each filing's download task instead of executing it
- drop the inert per-instance title on the inner download task
- diagnosable failures, real progress, and clean abort in the doc download
- make --force actually evict the cached accession document
- guard nullable primary_doc in the SPAC download worklist
- make primary_doc nullable and pin the real fan-out shape
- isolate issuers in `spac process` and count real successes

#### eval

- carry owner_kind on the reference side so ownership scores
- scope personNameFields to person-only extractors, and pass it everywhere
- honor `disabled` in the s1 sweep and report the axes it ran at
- name every eval s1 fan-out axis, and keep partial sweeps
- define the four symbols main already imports
- print instructions without fixtures; restore s1 default guard
- count reproducibility against the fixtures actually measured

#### util

- fold Latin letters that carry their mark inside the glyph

#### s1

- gate the initialism exception on heading shape and make the echo drop attributable
- stop dropping real risk-factor captions as carried-heading echoes
- drop only the chunker's own heading echoes, restore the strict mixed-shape guard
- bound throttle waits, narrow 429 detection, verify what gets stored
- store a risk-factor caption verbatim or not at all
- classify an exhausted throttle transiently and let Ctrl-C through
- ratio-gate the mixed risk-caption shape guard
- bound throttle waits, narrow 429 detection, verify what gets stored

#### models

- keep OpenRouter variant suffixes, de-race the readiness memo

#### config

- double the default max tokens for improved output handling
- fail fast on a malformed extraction temperature
- restore claude-sonnet-5 as the extraction default model

#### registerModels

- update dtype in provider configuration from "q4" to "f16q4" for improved model performance

#### forms

- count outcomes deterministically per extractor

#### html

- strip comments with a linear DOM walk, unblocking CI

### Refactors

#### cli

- update runCliProcess to use async/await and improve error handling

#### fetch

- streamline response type guessing and add tests for SecFetchAccessionDocTask

#### eval

- extract S-1 oracle run helpers for MapTask tasks
- expose extractor instruction builders for prompt dump

#### model

- update model ID handling to require explicit prefixes for onnx: llama: node-llama: open-router: etc

#### s1

- extract buildExtractionPrompt for shared dump path

### Performance

#### spac

- page the download worklist scan and narrow it by form

#### html

- resolve style and walk the DOM without per-node cheerio wrappers

### Style

#### spac

- terminate the cursor walk on truthiness

### Tests

- fix from failing
- add unit tests for EvalExtractTask to validate fixture handling fixes

#### versioning

- correct the registered-component count for Form RW

#### componentRegistry

- update component count in tests to reflect new extractors and resolvers

#### fetch

- pin the in-job loop against the post-delivery retry ban

#### sec

- enhance handling of CJK names and placeholders in S-1 processing

#### cli

- assert the registered command tree, not help-text substrings
- assert the CLI boot exit code and every command group
- guard the command graph against an unloadable import

#### redemption

- follow the dead-letter attempts semantics to their consumer

#### eval

- cover --print-prompts schema CLI listing and dump

### Documentation

- describe the conditional 8-K classifier and the 25-15 extractor

#### sec

- document family keys, diacritic folding, and re-keying

#### spac

- state the --force eviction tradeoff honestly

#### claude

- describe golden-label coverage and the cost of a bare eval s1

### Chores

- update deps
- update deps based on audit
- update deps (workglow)
- update deps
- update dependencies

### Updated Dependencies

- `@workglow/cli`: 0.3.45
- `fast-xml-parser`: ^5.11.0
- `pg`: ^8.23.0
- `typebox`: 1.3.14
- `workglow`: 0.3.45
- `concurrently`: ^10.0.5

## 0.0.23

### Features

- enhance extraction evaluation with reproducibility metrics
- enhance OpenAI reasoning effort configuration and improve extraction temperature handling
- add fast database count estimates

#### s1

- extract the Item 402 Summary Compensation Table
- extract the risk-factor list from prospectus sections

#### resolver

- version-scoped coverage and drop-previous for family tiers

#### forms

- dead-letter the storage-handler path instead of aborting the sweep

### Bug Fixes

- batch prune's candidate lookup, bound current_sic, share the sqlite harness (#244)

#### db

- report n/a for a missing table instead of failing `db stats` (#249)
- count estimates against the real table names (#248)
- build the rate-limiter ledger components from the shared factory
- stop dropping the shared migration ledger in a scoped db reset
- derive db reset's rate-limiter table names from the limiter config

#### s1

- keep the position row's fiscal year, and flag a missing comp section
- keep bare-phrase risk captions when a section yields nothing else

#### forms

- fail loudly on a missing storage handler instead of dead-lettering it
- strip the xsl viewer prefix before sanitizing the cache path

#### html

- keep a section heading, and the first instance of furniture

### Refactors

#### forms

- type the parsed form document instead of passing any

#### config

- drive both DI bootstraps from one storage registry

### Tests

#### config

- assert the testing bootstrap binds every registered storage
- guard that db setup reaches every registered storage

### Documentation

- point the add-a-table workflow at the storage registry
- describe the storage registry both DI bootstraps read

### Build

- enhance source mode handling and improve package management scripts

### Chores

- update dependencies and enhance extraction evaluation features
- update workglow and deps
- update GitHub Actions workflow to support manual dispatch and improve concurrency handling

### Updated Dependencies

- `@sroussey/parse-full-name`: ^3.0.0
- `@workglow/cli`: 0.3.38
- `csv-parse`: ^7.0.2
- `typebox`: 1.3.11
- `workglow`: 0.3.38
- `@types/pg`: ^8.21.0
- `better-sqlite3`: ^13.0.3

## 0.0.22

### Bug Fixes

#### db

- report `n/a` for a table the database has not created instead of failing the whole `db stats` report; `TableStat.rows` widens to `number | null`

## 0.0.21

### Features

- export the canonical person identity tier from the barrel

#### config

- add a table ownership registry and a Postgres column-alignment pass

#### spac

- implement SPAC candidate identification and backfill name history

#### fixtures

- pin golden fixture provenance + `sec fetch golden-fixtures`

#### forms

- add new forms for application withdrawal, broker-dealer, correspondence submission types, development bank, exchange registration, exempt offerings, foreign registration statements, investment companies, and miscellaneous filings

### Bug Fixes

#### html

- drop repeated heading furniture in the de-paginator

#### address

- merge the resume copy instead of failing on a live row
- make the SQLite addresses rebuild crash-safe

#### cli

- validate spac candidates options and widen the name columns

#### submissions

- keep the name timeline single-valued

#### spac

- dispatch the candidate scan through resolveSqlBackend
- consult the current name before the closed-interval date

#### db

- truncate the spac_candidate repo in the in-memory reset
- make the Postgres reset atomic; drop the unused createStorage parameter
- scope `db reset` to the tables sec owns
- restore the schema migrations `db setup` runs on an existing database

#### db,forms

- address review findings on the migration and reset work

#### forms

- release each filing's owned fetch workflow in the unbounded sweeps

#### storage

- scope the dry-run guard to writes; require the repo argument
- stop raw-SQL paths writing under --dry-run; harden the title bulk read

#### s1

- address review findings and decouple from unreleased workglow API
- stop retaining every section's prompt for the life of a sweep

#### bootstrap

- reject path-traversal in filer-controlled primary_doc

### Refactors

#### observation

- use the storage `in` operator instead of hand-written SQL

#### schema

- route every CIK through TypeSecCik, bound every SIC

### Performance

#### observation

- read observation titles in one IN-list, not one query per id

#### storage

- index the per-issuer reads on the link and observation tables

#### fixtures

- trim quarterly master.idx fixtures 49 MB -> 1.2 MB

### Tests

#### spac

- pin buildScanSql against its repository twin on real SQLite

#### forms

- update the DRSLTR assertion for its new catalog entry

### Documentation

- track the reset's shared-object caveats as issues, not as a caveat block

#### spac

- align the confidence ladder with the classifier

### Updated Dependencies

- `@workglow/cli`: 0.3.37
- `workglow`: 0.3.37

## Unreleased

### Bug Fixes

#### db

- restore the schema migrations `db setup` runs on an existing database
- align Postgres column widths and nullability with the declared schemas
- scope `db reset` to the tables sec owns, with `--cascade` / `--drop-schema`

#### forms

- release each filing's owned fetch workflow so an unbounded sweep stops
  retaining every submission body it fetched

### Chores

#### deps

- bump workglow to 0.3.36 for `context.disown` (0.3.35 was never published)

### Updated Dependencies

- `@workglow/cli`: 0.3.36
- `workglow`: 0.3.36

## 0.0.20

### Features

#### task

- give every task a title so progress rows are readable

### Tests

#### task

- don't let an un-parameterized task class evade the title guard

### Chores

#### deps

- bump workglow to 0.3.34 for the two-argument context.own

### Updated Dependencies

- `@workglow/cli`: 0.3.34
- `workglow`: 0.3.34
- `@types/pg`: ^8.20.3

## 0.0.19

### Features

#### models

- enhance secModelRecord to throw on unknown model ids

#### address, phone

- introduce saveAddressIfUsable and savePhoneIfUsable methods

#### eval

- recognize `deepseek-*` model ids and price them
- introduce sweepStepContext for improved progress tracking

#### bootstrap

- add --force option to re-download archives

#### address

- keep US addresses whose filer left the state blank

### Bug Fixes

#### config

- stop warning on the absent DeepSeek subpath; correct json-mode docs

#### forms

- stream the worklist producer instead of materializing every filing

### Performance

#### forms

- emit the worklist in bounded batches instead of all at once

### Documentation

- note that DeepSeek's json-mode is not schema-enforced

### Chores

#### deps

- bump workglow to 0.3.33 and make DeepSeek routable

### Updated Dependencies

- `@workglow/cli`: 0.3.33
- `workglow`: 0.3.33

## 0.0.18

### Chores

- update workglow
- update dev container

### Updated Dependencies

- `@workglow/cli`: 0.3.31
- `typebox`: 1.3.9
- `workglow`: 0.3.31
- `better-sqlite3`: ^13.0.2

## 0.0.17

### Features

#### forms

- scale the forms sweep — cluster rate limiting, sharding, doc cache

#### bootstrap

- download accession documents via daily Feed tarballs

#### address

- enhance address normalization for foreign addresses

### Bug Fixes

#### eval

- restore SEC_UNIT_TERMS_REF override with fail-fast on missing path

### Refactors

- store person titles as dated per-title rows, not arrays (#216)

#### forms

- replace UpdateAllFormsTask with ComputeFormsWorklistTask and enhance forms processing

### Tests

#### config

- strip env-derived DI tokens on TestingDI reset

### Chores

- update dep parse-address

#### test

- switch runner to vitest with hardening

### Updated Dependencies

- `@modelcontextprotocol/sdk`: ^1.30.0
- `@sroussey/parse-address`: ^3.2.0
- `@workglow/cli`: 0.3.29
- `typebox`: 1.3.8
- `workglow`: 0.3.29
- `concurrently`: ^10.0.4

## 0.0.16

### Chores

- update workglow

### Updated Dependencies

- `@workglow/cli`: 0.3.28
- `typebox`: 1.3.7
- `workglow`: 0.3.28

## 0.0.15

### Features

#### canonical

- add CanonicalCompanyRepo and related exports for entity mapping

## 0.0.14

### Features

#### eval

- SEC_UNIT_TERMS_REF override for the unit-terms reference CSV

## 0.0.13

### Bug Fixes

#### test

- reset SEC_DRY_RUN after UpdateAllCompanyFactsTask tests

#### db

- widen XBRL context_ref + self-heal existing Postgres columns

#### facts

- accept real EDGAR company-facts shapes during ingest

## 0.0.12

### Features

#### fetch

- let caller-supplied User-Agent override the default

#### barrel

- export FamilyResolver/normalizeFamilyName/CanonicalFamilyAliasRepo for downstream family tiers
- export TaskPorts type bridge for downstream task authors
- export Value from typebox/value for downstream schema tests
- export Task/Workflow/IExecuteContext/isStaleByAsOf for downstream ingestion
- export ServiceToken type for downstream DI token authoring
- re-export globalServiceRegistry + typebox Type for single-instance DI/schemas
- export resetDependencyInjectionsForTesting for downstream test setup
- export internals needed by downstream feature packages

#### config

- DatabaseExtensionRegistry wired into setup/reset
- registerSecResolvers registers built-in kinds via the registry

#### resolver

- add ResolverExtensionRegistry

### Bug Fixes

#### fetch

- handle arraybuffer response_type in the file output cache
- thread caller headers through SecCachedFetchTask.execute

#### docs

- update references to package name in CLAUDE.md and improve formatting for clarity

#### package

- stop shipping src/ in the published tarball; add prepack safeguard (#204)

#### build

- stop trusting import.meta.dir for read-only fixture / write-side cache paths

#### cli

- reject non-integer CIKs at the arg parser instead of parseInt

#### config

- register sec resolvers in setupAllDatabases before version bootstrap

### Refactors

- remove accredited-portal feature from sec (moved to embarc-data)

#### form-d

- remove inline portal attribution from ingestion

#### versioning

- make resolver-versioning registry-driven

### Documentation

- accredited-portal moved to embarc-data; document extension registries

### Chores

- update parse-address dep
- update deps
- add link and link-workglow scripts for local libs
- update package.json for project rebranding and configuration

### Updated Dependencies

- `@sroussey/parse-address`: ^3.0.2
- `@workglow/cli`: 0.3.27
- `csv-parse`: ^7.0.1
- `fast-xml-parser`: ^5.10.1
- `workglow`: 0.3.27

## 0.0.11

### Chores

- update package.json and sec.ts for project rebranding and structure

## 0.0.10

### Features

- expose library surface for superset CLIs (#203)
- add accredited-investor portal attribution for Form D filings (#197)
- add SPAC consolidated report with lifecycle tracking (#164)
- add Form 8-K parsing and event storage infrastructure (#68)
- add CFPORTAL form parsing and Reg A query support (#133)
- track company facts fetch/store outcomes with retry support (#132)
- add offering terms, underwriters, and use-of-proceeds extraction (#128)
- extend ReadOnlyTabularStorage with new getOffsetPage method and update getBulk signature
- enhance ReadOnlyTabularStorage with pagination and query capabilities
- enhance bootstrap tasks and error handling

#### cli

- run query and db commands as task graphs via the workflow renderer
- honor --json flag in status and error output (#193)
- sponsor-family alias management + alias-aware 'spac by-family' query
- extend sec version coverage to resolver kind
- add sec canonical {person|company} alias commands
- add sec resolve --kind --version --all

#### models

- download model weights before use, with on-screen progress (#198)

#### eval

- default the S-1 oracle reference to opus
- golden-truth oracle + reconcile table/bio roles
- score field-values by F1 so over-production is penalized
- surface per-row/field disagreements after a run
- add OpenAI, Gemini, and xAI providers to the model harness
- oracle comparison over real S-1 sections
- model comparison harness + local model wiring

#### spac

- AI SPAC classifier, sponsor promote, de-SPAC linkage (#149, #150, #151)
- investorpres slot, portal featured, family descriptions
- target_description from merger proxies onto the deal + row
- SPAC business profile + leadership bio/birth_year extraction

#### xbrl

- ISO date transforms + CIK/dimension query coverage (#154) (#195)

#### s1

- skip nonce echo for local providers
- treat a board chair as implying director (drop redundant "Director")
- model person titles as a list of distinct roles (titles[])
- canonicalize management titles post-model
- extract SPAC sponsors into legal-sponsor + family tiers with links
- add extractSpacSponsors structured extractor
- write deterministic SPAC classification from header SIC
- add shared SGML-header + primary-document submission parser
- add real S-1 fixture sampler and document the extraction flow
- add dead-letter retry sweep, extractor CLI, and promote eligibility announce
- add S-1 prospectus extraction pipeline and dispatch
- add observation-provenance, beneficial-ownership, related-party, and dead-letter storage tiers

#### config

- node-llama-cpp GGUF local provider + workglow mega imports
- register SEC AI models in the global model repository

#### extractors

- register AI providers + retry model-error dead-letters without a version bump

#### sec

- SPAC de-SPAC lifecycle — 8-K milestones, merger-proxy & redemption extraction (#166)

#### forms

- route F-1 / F-1/A / F-1MEF (foreign issuer) through the S-1 extractor
- dispatch DRS/DRS/A to S-1 extractor; fetch registration forms as .txt
- split fetch/parse failure domains in ProcessAccessionDocFormTask
- ingest Section 16 (3/4/5) and Form 144 ownership filings (#116)

#### canonical

- add SponsorFamilyMembership + SpacSponsorLink tables with DI
- add CanonicalSponsorFamily + alias tables with DI
- emit `current_canonical_*` view DDL
- add alias repos with single-hop invariant
- add four canonical-level address/phone junction repos
- add CompanyIdentityLinkRepo
- add PersonIdentityLinkRepo
- add CanonicalCompanyRepo
- add CanonicalPersonRepo
- add alias schemas
- add canonical-level address/phone junction schemas
- add identity-link schemas
- add CanonicalCompanySchema
- add CanonicalPersonSchema

#### resolver

- add SponsorFamilyResolver + register sponsor-family resolver kind
- add EntityObserver helper for form storage modules
- add CompanyResolver v1 with CIK/CRD/name rules + alias pass
- add PersonResolver v1 with CIK/name rules + alias pass
- add resolverIds module

#### storage

- add S1ClassificationRepo (filing-level SPAC record) + DI

#### html

- add form-agnostic EDGAR HTML to Document-tree converter

#### versioning

- add dropPrevious tests for extractor and resolver kinds
- extend drop-previous to resolver rows + orphan cleanup
- add ceremony CLI (start-dev, promote, rollback, drop-next, coverage, history); remove seed-test
- add VersionCoverage and VersionHistory queries
- add ceremonies module (startDev / promote / rollback / dropNext)
- add getActiveSlot helper (next-if-exists routing)
- add VersionEventRepo for ceremony audit log
- add VersionEvent schema and DI wiring
- add semver helpers (parse, major.minor, bump-progression validation)
- add target_count column to component_versions
- add ExtractorRunRepo helper
- bootstrap extractor versions on db setup
- add idempotent bootstrapExtractorVersions seeder
- add FORM_TO_EXTRACTOR_ID mapping and ExtractorId type
- add 'sec version status' and 'sec version seed-test' CLI
- add VersionStatus query for CLI rendering
- add VersionRegistry helper with slot accessors
- register ComponentVersion and ExtractorRun repos in DI
- add ExtractorRun schema and DI token
- add ComponentVersion schema and DI token

#### observation

- add CompanyObservationRepo
- add PersonObservationRepo with natural-key upsert
- add CompanyObservationSchema
- add PersonObservationSchema

### Bug Fixes

- address xhigh code-review findings
- update warning messages and improve test descriptions
- DRSLTR dispatch, SPAC sponsor span verification, resolver test + RFC-9112 Content-Length (#127)
- address code review issues — dropPrevious orphan check, DbStatus new tables, drop-previous CLI verb, resolve test coverage, CompanyResolver secondary keys
- init

#### sec

- CLI validation, portal-attribute reporting, gguf path check (#201)
- make local GGUF models usable in eval and exit cleanly
- isolate redemption model-resolution + bulk-skip backfill candidates
- record extractor_runs for redemption + idempotent, fast backfill

#### query

- reject empty CIK filters

#### cli

- report expected user-errors through task output ports; dedupe tier wiring
- preserve JSON workflow error handling
- make streamed query totalApprox a meaningful lower bound (#112)

#### editorial

- isolate multi-file import failures

#### s1

- one owner per name; quote key lists in eval diffs
- drop ownership subtotal rows; add beneficial-ownership golden truth
- close the GBNF []-shortcut on nested titles[] too
- harden sponsor extraction + sponsor-family storage from code review

#### eval

- fail loudly when an extractor has no fixtures
- normalize commas and initial/suffix periods in name alignment
- restore stderr progress for eval tasks when piped

#### spac

- make de-SPAC linkage a write-once close-time snapshot
- stop deriving phantom deals after a completed combination
- gate SQLite withSpacCikLock through process-wide mutex (avoid concurrent BEGIN IMMEDIATE crash)
- allow caller-supplied pool client to recomputeSpacDeals to avoid deadlock with outer lock
- atomic per-CIK rollup writes + monotonic history chain
- record extractor_runs for merger-proxy + transactional recompute

#### storage

- implement no-op updateWhere on ReadOnlyTabularStorage

#### resolver

- stabilize person name parts across punctuation/glyph variants
- instance-scope per-key mutex so multi-process race tests test what they claim (#160)
- FamilyResolver — alias inside mutex + UPPER case-normalization (#129)
- add readonly to PersonClaim/CompanyClaim; single timestamp per method

#### s1,eval

- director nominees + typographic name alignment

#### eval,s1

- render titles arrays clearly in diffs; sharpen split prompt

#### sec/424

- record deterministic SPAC IPO event even when AI model fails to resolve

#### facts

- derive fy sentinel from end_date to preserve PK width across period-agnostic facts
- accept EDGAR facts with null fy/fp

#### sec/extractors

- move verify nonce out of untrusted fence into trusted preamble
- add NONCE_MISMATCH dead-letter reason code
- gate reapStaleObservations on version change to prevent LLM-variance data loss on same-version re-runs

#### sec/html

- strip title/svg/math to close prompt-injection bypass in body-level and foreign-content elements

#### config

- declare Anthropic model capabilities so StructuredGenerationTask resolves
- init SQLite binding in setupAllDatabases before view DDL

#### extractors

- degrade gracefully when the AI model is unregistered

#### submissions

- store every filing row (proxy slice yielded undefined)

#### review

- clarify details doc + single-pass investorpres derivation
- address code-review findings + prettier
- close wave-2 (#177/#178/#179) review findings
- close 6 findings from max-effort review of the consolidation

#### canonical

- serialize junction observation_count with KeyedMutex
- align junction columns with address/phone schemas

#### util

- parseDate rejects calendar-invalid dates

#### xbrl

- XbrlFactRepo.replaceForAccession no-ops on 0 rows unless intentionalClear

#### forms

- close stripDoctype bypass via leading XML comment / PI
- restore predefined-entity decoding via bounded processEntities + DOCTYPE strip
- apply prompt-injection seal to merger-proxy + redemption extractors
- treat empty fetch body as no-text and swallow dead-letter write failures
- explicit null address_id/international_number in Form_1_Z signature observation
- remove dead resolveCountryCode from Form_1_K.storage

#### forms/s1

- close residual Unicode-invisible defang bypass
- widen defang TAG_SHAPED to admit whitespace mid-tag (closes &#10; bypass)
- wire new extractMergerDeal / extractRedemption to nonce-fence API
- per-call nonce fence + raw-span cap + multi-stage defang

#### forms/8-K

- auto-resolve redemption-partial-oversized dead-letter (informational only)
- cap redemption AI input bytes; drop oversized exhibits
- persist redemption extraction even when SPAC has no deal yet
- trust the actual repo nature, not the lingering SEC_DB_TYPE token
- tx writes, versioned PK, accession unification, XML entity hardening

#### versioning

- partial-success outcome on extractor_runs
- bump test timeout on multi-spawn CLI tests to 15s
- address PR #109 review feedback
- address final review items
- reject all start-dev variants when next slot exists; drop dead check; comment promote atomicity
- patch-gate listFilingsWithoutSuccessfulRun on major.minor prefix
- address independent code review
- address PR #107 review feedback
- use cik: number in ExtractorRunRepo query API (matches codebase convention)
- address PR #106 review feedback
- enforce semver and coverage_complete invariants in putSlot
- drop redundant PK-prefix indexes; wire resetAllDatabases; sort imports

#### resolver,forms/s1

- PG unique-violation recognition + family-tier UNIQUE convergence + S-1/424 prompt-injection hardening (3× HIGH) (#163)

#### forms,storage

- Form 144/Ownership whitespace→null, PG dedup, Form_C/1-A stale-replay guards (#159)
- 5 HIGH review findings — stale replay, point-in-time, undated guard, deal sort, Schedule A (#155)
- Crowdfunding history on stale replay + CFPORTAL/A inheritance + docs (#135)
- address Copilot review on PR #124

#### storage/canonical

- enforce UNIQUE constraints to close resolver race (#158)

#### forms,portal

- undated 1-K/1-Z guard + deterministic stale-replay tie-break (2 HIGH from code review) (#156)

#### forms,storage,cli

- person-collision issuer guard + alias chain block + CLI input validation + coverage perf (#122)

#### resolver,storage,cli

- resolver race + observation_id PK + CSV NBSP + download leak (sec) (#121)

#### section16

- preserve null vs 0 for empty numeric leaves on Forms 3/4/5 (#116 follow-up) (#117)

#### observation

- align raw_phone_id maxLength with PhoneSchema

#### ci

- set 30s global test timeout for multi-spawn CLI tests

### Refactors

- remove unused fn

#### task

- move src/fetch to src/task/fetch
- relocate EnsureModelDownloadedTask to src/task/model and name the file after the task

#### config

- make ensureModelDownloaded a task that infers provider from the model id
- import node-llama-cpp via the workglow mega package
- drop the spac narrative-column migration

#### eval

- inline oracle sweep into EvalS1Task; own AI subtasks
- rename `sec eval s1 --candidates` to `--models`

#### cli

- graph-ify every command through the workflow renderer

#### normalize

- shared typographic-punctuation fold for names

#### portal

- drop the featured column

#### canonical

- extract shared CanonicalJunctionRepo base

#### resolver

- extract shared normalizeSponsorFamilyName for consistent family keys

#### queue

- integrate wrapQueueStorage for SecJobQueue components

#### storage

- delete legacy PersonRepo, CompanyRepo, and their schemas

#### forms

- rewrite Form_1_Z.storage onto EntityObserver
- rewrite Form_1_K.storage onto EntityObserver
- rewrite Form_1_A.storage onto EntityObserver
- rewrite Form_C.storage onto EntityObserver
- rewrite Form_D.storage onto EntityObserver
- rewrite Form_D.storage onto EntityObserver

#### versioning

- route form-processing tasks via getActiveSlot (next-if-exists)
- UpdateAllFormsTask reads extractor_runs, drops --force
- write extractor_runs from ProcessAccessionDocFormTask
- derive TypeBox literal unions from const arrays

### Tests

- use vitest so we can try node when needed
- add unit tests for SecFetchJob functionality

#### 424

- isolate the priced-prospectus fixture from S-1 discovery globs
- pin priced-prospectus pipeline with a real 424B4 golden fixture

#### versioning

- update registered-component assertions for sponsor-family resolver kind

#### s1

- add synthetic DRS .txt fixture exercising header parse + DRS dispatch
- end-to-end SPAC classification + sponsor family linkage + DRS dispatch

#### forms

- assert FETCH_ERROR status pending; clarify Domain 3 throw comment
- cover fetch-layer dead-letter paths (PRIMARY_DOC_UNRESOLVED, FETCH_ERROR, parse rethrow)

#### fixtures

- add fetch-fixtures script for pulling real EDGAR data (#108)

### Documentation

- update CLAUDE.md and new-module JSDoc for PR4
- update paths for design specs and plans in various skills and documentation

#### eval

- drop LFM2.5 references; default the sweeps to cloud models
- document evaluating Bonsai 27B via the local GGUF path (#187)

#### 8-K

- note metadata items/report_date are authoritative

#### s1

- document sponsor-text extraction strategy in processFormS1

### Chores

- rename bunsrc scripts for clarity
- bump workglow/cli 0.3.26, compromise 14.16.0, fast-xml-parser 5.10.0
- keep typebox 1.3.6 from main after rebase
- update deps
- keep extractor versions at 1.0.0 (no data to re-extract)
- update deps
- update deps
- ignore .worktrees directory
- update deps
- update deps
- update dependencies and ESLint configuration
- update dependencies and enhance CIK query functionality

#### config

- drop local HuggingFace/ONNX provider wiring
- register observation/canonical repos in DI; add view DDL

#### extractors

- default AI model to claude-sonnet-5 via shared SecModelDefault

#### deps

- update @workglow/cli and related packages to version 0.3.13; add new domNodes.ts file for cheerio DOM node types

#### versioning

- rename bootstrapExtractorVersions; seed resolver components
- register resolver:person and resolver:company
- retire processed_filings; DbStatus reports extractor_runs

### CI

- limit rebuilds

### Updated Dependencies

- `@modelcontextprotocol/sdk`: ^1.29.0
- `@workglow/cli`: 0.3.26
- `commander`: ^15.0.0
- `compromise`: ^14.16.0
- `fast-xml-parser`: ^5.10.0
- `pdf2json`: ^4.0.3
- `pg`: ^8.22.0
- `typebox`: 1.3.6
- `workglow`: 0.3.26
- `@types/bun`: 1.3.14
- `bunset`: 1.0.13

## 0.0.9

### Chores

- update @workglow packages to version 0.2.0

### Updated Dependencies

- `workglow`: 0.2.0
- `@workglow/cli`: 0.2.0

## 0.0.8

### Refactors

#### Form

- improve jpath type check in XML parsing options

### Chores

- update @workglow packages to version 0.0.125
- update @workglow packages to version 0.0.124
- update @workglow packages to version 0.0.123
- update documentation and dependencies for CLI improvements
- upgrade actions/setup-node to v6 in GitHub workflows
- upgrade actions/checkout to v6 in GitHub workflows
- update dependabot configuration to group @workglow packages

### Updated Dependencies

- `@workglow/cli`: 0.0.126
- `csv-parse`: ^6.2.1
- `fast-xml-parser`: ^5.5.9
- `@types/bun`: 1.3.11

## 0.0.7

### Features

- wire up --dry-run flag to prevent all writes (#75)

#### cli-v2

- implement db status and db stats commands
- implement all query commands (offerings, crowdfunding, facts, persons)
- implement filing query command
- implement entity query command
- add interactive init wizard
- restructure commands into nested groups
- add output barrel export
- add runCommand error wrapper with exit codes
- add progress bar and spinner utilities
- add table renderer with table/csv/json formats
- add global options infrastructure

### Bug Fixes

- prevent bun test exit code 1 when all tests pass (#67)
- CLI v2 review feedback — input validation, escaping, type safety, and docs alignment (#66)

### Refactors

#### cli-v2

- improve dependency injection initialization in command handling
- remove old flat command files

### Tests

#### cli-v2

- enhance runCommand tests with exit code handling
- add CLI integration smoke test

### Documentation

- update SPEC.md to v2 CLI design

### Build

#### deps-dev

- bump @types/bun from 1.3.9 to 1.3.10 (#74)

### Chores

- update dependencies and remove auto-assign workflow

### Updated Dependencies

- `@workglow/cli`: 0.0.117
- `@workglow/job-queue`: 0.0.117
- `@workglow/sqlite`: 0.0.117
- `@workglow/storage`: 0.0.117
- `@workglow/task-graph`: 0.0.117
- `@workglow/tasks`: 0.0.117
- `@workglow/util`: 0.0.117
- `fast-xml-parser`: ^5.5.3
- `pg`: ^8.20.0
- `typebox`: 1.1.6
- `@types/bun`: 1.3.10
- `bunset`: 1.0.10

## 0.0.6

### Features

- integrate PostgreSQL support and enhance configuration
- add BootstrapSubmissions command and task for processing SEC submissions (#62)
- Implement storage layers for Forms C, 1-A, 1-K, 1-Z with Reg-A infrastructure
- Implement temporal crowdfunding repository with history and change tracking, including new schemas and tests.
- add storage layer with entity and address history tracking
- [WIP] crowdfunding
- add UpdateAllForms command and task for batch processing forms
- create storage with repo/schema/tests/spec and use for entity, submission, filings, and form-d
- add document and form processing commands
- implement address and person normalization with repository structure
- add new form classes for Regulation A reports
- update package dependencies and enhance README documentation
- rename from ellmers to podley
- when using a starting year, just get current quarter
- enhance UpdateAllCompanyFactsTask and UpdateAllSubmissionsTask with improved processing and progress tracking
- create classes for most form types
- enhance submission tasks with validation and processing improvements
- update CompanySubmission types for improved accuracy
- add new SEC form types and enhance existing ones
- enhance UpdateAllSubmissionsTask with processing success tracking
- enhance SEC form types and validation
- add UpdateAllSubmissions command and task
- add UpdateAllCompanyFactsTask
- Implement SEC CLI with initial commands and tasks

### Bug Fixes

- Update FetchDailyIndexTask test to use new @workglow/job-queue API
- typebox clone requirement when extending Base
- remove any xsl transform from path
- update import paths for task and queue modules
- no turbo here, so build should just be build
- sec error strings
- paths
