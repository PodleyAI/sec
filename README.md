# SEC Guide

## Table of Contents

- [Table of Contents](#table-of-contents)
- [Setup](#setup)
- [CIKs](#ciks)
- [Indexes: Quarterly, and Daily](#indexes-quarterly-and-daily)
  - [Code](#code)
  - [Usage](#usage)
- [Company Submissions](#company-submissions)
  - [Data Retrieved](#data-retrieved)
  - [Code](#code-1)
  - [Usage](#usage-1)
- [Filing Submissions and Forms](#filing-submissions-and-forms)
  - [Common Forms](#common-forms)
- [Company Facts](#company-facts)
  - [Code](#code-2)
  - [Usage](#usage-2)
- [SPACs](#spacs)
- [Portals](#portals)
- [Reg-A and Reg-A+](#reg-a-and-reg-a)
- [Reg-CF](#reg-cf)

---

## Setup

To install dependencies, run:

```bash
bun install
```

Create a `.env.local` file in the root of the project and add the following:

```bash
SEC_RAW_DATA_FOLDER=<path-to-raw-data>
SEC_DB_FOLDER=<path-to-db-folder>
SEC_DB_NAME=edgar
```

## CIKs

The **CIK (Central Index Key)** is a unique identifier assigned to companies and individuals by the SEC.

To facilitate data retrieval, maintaining a full list of CIK numbers and their associated names is beneficial. Even if only a subset of filings is required, having a reference list is useful. The SEC provides an official [CIK lookup file](https://www.sec.gov/Archives/edgar/cik-lookup-data.txt).

You can retrieve and process this file using the following:

- **Task:** [FetchAllCikNamesTask.ts](./src/task/base/FetchAllCikNamesTask.ts)
- **Command:** [BootstrapAllCikNames.ts](./src/commands/base/BootstrapAllCikNames.ts)

```bash
./src/sec.ts bootstrap-all-cik-names
```

## Indexes: Quarterly, and Daily

The SEC publishes `txt` index files listing all submitted filings. Each entry includes:

- Company Name
- CIK Number
- Filing Form Type
- Submission Date & Time

### Code

- **Task:** [FetchQuarterlyIndexRangeTask.ts](./src/task/index/FetchQuarterlyIndexRangeTask.ts)
- **Command:** [BootstrapCikLastUpdate.ts](./src/commands/BootstrapCikLastUpdate.ts)

### Usage

We utilize these indexes to generate a **"dirty" CIK list**, indicating which filings need to be downloaded. While an optimized approach would selectively fetch only required filings, our method ensures data integrity by marking CIKs for processing. This helps recover missing files due to: process failures, skipped days, and other errors.

```bash
./src/sec.ts bootstrap-quarterly-index <year to start>
```

## Company Submissions

The SEC provides an API to fetch company submission data, including metadata about a company's filings. However, it does not include the actual filing contents.

### Data Retrieved

- **Accession Number** – Unique filing identifier
- **Filing Date** – Submission date
- **Form** – Filing type
- **Filename** – Associated document
- **Description** – Filing summary
- **Document Type** – Type of content submitted
- **Size** – File size (bytes)
- **Items** – Number of included items

### Code

- **Task:** [FetchSubmissionsTask.ts](./src/task/submissions/FetchSubmissionsTask.ts)
- **Command:** [CompanySubmissions.ts](./src/commands/submissions/CompanySubmissions.ts)

### Usage

```bash
./src/sec.ts company-submissions 1018724
```

## Filing Submissions and Forms

The SEC API allows retrieval of individual filing submissions, containing the actual filing data. Each form type has unique processing requirements.

### Common Forms

- **Form D** – Private capital fundraising
- **Form 10** – Public capital fundraising
- **Form 10-K** – Annual financial report
- **Form 10-Q** – Quarterly financial report
- **Form 8-K** – Material event disclosures
- **Form 6-K** – Foreign company disclosures
- **Form 4** – Insider trading disclosures

## Company Facts

The SEC API provides **Company Facts**, delivering structured and normalized financial and operational data for a specific company.

### Code

- **Task:** [FetchCompanyFactsTask.ts](./src/task/facts/FetchCompanyFactsTask.ts)
- **Command:** [CompanyFacts.ts](./src/commands/CompanyFacts.ts)

### Usage

```bash
./src/sec.ts company-facts 1018724
```

## SPACs

**Special Purpose Acquisition Companies (SPACs)** are formed to raise capital from public investors with the intent to acquire a private company and take it public.

## Portals

**Reg-A and Reg-CF Portals** facilitate investment in private companies by public investors through SEC-regulated platforms.

## Reg-A and Reg-A+

**Regulation A (Reg-A) and Regulation A+ (Reg-A+)** filings enable private companies to raise funds from public investors via SEC-registered portals.

## Reg-CF

**Regulation Crowdfunding (Reg-CF)** allows private companies to raise smaller amounts of capital from public investors compared to Reg-A or Reg-A+.
