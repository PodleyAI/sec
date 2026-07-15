# Changelog

## Unreleased

### Bug Fixes

- add `titles` column migration for `person_observations` — existing
  databases predate the `title` → `titles` rename and CREATE TABLE IF NOT
  EXISTS is a no-op on already-created tables; the first write hits `table
  has no column named titles`. Wired before `PersonObservationRepo.setupDatabase()`.
- add `loi_date` column migration for `spac`, `spac_deal`, `spac_history` —
  same CREATE TABLE IF NOT EXISTS problem after the LOI lifecycle stage
  landed. `spac.status = "loi"` needs no DDL (`TypeStringEnum` emits plain
  TEXT with no CHECK constraint).
- bump the person resolver to `2.0.0` — `PersonNormalization` now strips
  periods/commas and folds typographic apostrophes, which changes the
  `(normalized_first, normalized_middle, normalized_last, normalized_suffix)`
  tuple `PersonResolver.personKey` looks up by. Post-fold observations under
  the same `resolver_version` silently miss pre-fold canonicals and mint
  duplicates.

### Operator Ceremony (person resolver 2.0.0)

Existing DBs must run through the version-bump ceremony to migrate
identities across the fold. Aliases must be re-applied manually against the
fresh 2.0.0 canonical UUIDs (`sec canonical person alias-list` before the
ceremony; re-issue `sec canonical person alias` after).

```sh
sec version start-dev resolver person 2.0.0 --bump major \
  --notes "PersonNormalization punctuation/typographic fold changes key tuple"
sec resolve --kind person --resolver-version 2.0.0 --all
sec version coverage resolver person
sec version promote resolver person
sec version drop-previous resolver person
```

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
