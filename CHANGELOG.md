# Changelog

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
