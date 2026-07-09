# Architecture Guide

This document explains how the SEC EDGAR data pipeline works end-to-end, and how to add support for a new form type.

## Data Pipeline Overview

The system follows a three-phase pipeline: **Index Discovery → Submission Processing → Form Processing**. Each phase fetches data from the SEC EDGAR API, transforms it, and stores it in a local SQLite database.

```
Index (discover CIKs)
  → Submissions (fetch company metadata + filing lists)
    → Forms (fetch individual filing documents, parse, and store)
```

---

## Phase 1: Index Discovery

**Goal:** Discover which companies (CIKs) have new filings.

**CLI commands:**

- `daily-index [date]` — fetch a single day's index
- `quarterly-index [date]` — fetch a single quarter's index
- `quarterly-index-range [start] [end]` — fetch a range of quarters

**How it works:**

1. `FetchDailyIndexTask` (or `FetchQuarterlyIndexTask`) fetches a master index file from SEC:
   ```
   https://www.sec.gov/Archives/edgar/full-index/{year}/QTR{quarter}/master.idx
   ```
2. The index is a pipe-delimited text file listing every filing for that period. Each row contains a CIK, company name, form type, date, and path.
3. The task parses this file and extracts a deduplicated list of `[cik, last_known_update]` pairs.
4. `StoreCikLastUpdatedTask` writes these pairs into the `cik_last_update` table using batch `INSERT OR REPLACE`.

**Result:** The `cik_last_update` table now knows which CIKs have activity and when their most recent filing was.

**Key files:**

- `src/task/index/FetchDailyIndexTask.ts`
- `src/task/index/FetchQuarterlyIndexTask.ts`
- `src/task/index/StoreCikLastUpdatedTask.ts`
- `src/commands/DailyIndex.ts`

---

## Phase 2: Submission Processing

**Goal:** For each CIK with new activity, fetch its full company submission data (metadata + list of all filings).

**CLI commands:**

- `submissions <cik>` — fetch a single company's submissions
- `update-all-submissions` — batch process all CIKs with new activity

**How it works:**

1. `UpdateAllSubmissionsTask` queries the database for CIKs where `cik_last_update.last_update > processed_submissions.last_processed` (or where no prior processing exists).
2. For each CIK (batched, 2 in parallel), it runs:

   **Fetch phase** (`FetchSubmissionsTask`):
   - Fetches the main submission JSON from `https://data.sec.gov/submissions/CIK{cik:10-padded}.json`
   - Validates against the TypeBox schema
   - If `filings.files[]` contains additional JSON files (for companies with many filings), fetches and merges those too
   - Returns a consolidated `{ submission, filings }` object

   **Store phase** (`StoreSubmissionsTask`):
   - Runs 5 storage tasks **in parallel**:
     - `StoreSubmissionSicTask` — SIC industry classification codes
     - `StoreSubmissionEntityTask` — entity metadata (name, type, EIN, state, etc.)
     - `StoreSubmissionContactInfoTask` — mailing/business addresses and phone numbers
     - `StoreSubmissionTickersTask` — stock ticker symbols and exchanges
     - `StoreSubmissionFilingsTask` — individual filing records (accession number, date, form type, primary document filename, etc.)
   - Marks the CIK as processed in `processed_submissions`

**Result:** The `filings` table now contains a row for every filing by every active CIK, including the `form` type and `primary_doc` filename needed to fetch the actual document.

**Key files:**

- `src/task/submissions/FetchSubmissionsTask.ts`
- `src/task/submissions/StoreSubmissionsTask.ts`
- `src/task/submissions/StoreSubmissionFilingsTask.ts`
- `src/task/submissions/UpdateAllSubmissionsTask.ts`
- `src/commands/Submissions.ts`

---

## Phase 3: Form Processing

**Goal:** Fetch individual filing documents from SEC Archives, parse their XML/HTML content into structured data, and store the results.

**CLI commands:**

- `form <cik> <form> [docid]` — process forms for a single company
- `update-all-forms <form1,form2,...>` — batch process all unprocessed filings of given form types

**How it works:**

1. `UpdateAllFormsTask` queries the `filings` table for rows where the `form` column matches the requested types and the filing is not yet in `processed_filings`.
2. For each filing (batched, up to 10 in parallel), it runs `ProcessAccessionDocFormTask`:

   **Step 1 — Resolve filing details:**
   If `cik`, `form`, or `fileName` are not provided, query the `filings` table by `accession_number` to fill them in.

   **Step 2 — Fetch the document:**
   `SecFetchAccessionDocTask` downloads the document from:

   ```
   https://www.sec.gov/Archives/edgar/data/{cik}/{accession-no-dashes}/{filename}
   ```

   Results are cached to disk (filings are immutable once submitted).

   **Step 3 — Parse and store:**
   - Look up the parser class from `ALL_FORMS_MAP` using the form name (e.g., `"D"` → `Form_D`)
   - Call `FormClass.parse(form, text)` to parse the XML into a typed object
   - The parser's associated storage function transforms the parsed data into normalized database records
   - Record the filing in `processed_filings` as successfully processed

**Result:** Structured, normalized data from the filing is stored across multiple tables (entities, persons, companies, addresses, phones, investment offerings, etc.).

**Key files:**

- `src/task/forms/ProcessAccessionDocFormTask.ts`
- `src/task/forms/SecFetchAccessionDocTask.ts`
- `src/task/forms/FetchAndStoreFormsTask.ts`
- `src/task/forms/UpdateAllFormsTask.ts`
- `src/commands/Form.ts`

---

## Form Registration System

All form parsers are registered in a central map so `ProcessAccessionDocFormTask` can look them up by form name at runtime.

```
src/sec/forms/all-forms.ts
├── ALL_FORM_NAMES — flat array of every supported form name string
├── ALL_FORMS_MAP  — Map<string, FormConstructor> mapping form name → parser class
└── Aggregates from each form category's index.ts
```

Each form category directory (e.g., `exempt-offerings/`, `insider-trading/`) exports:

- A `FORM_NAMES_MAP` array of `[formName, FormClass]` tuples
- A `FORM_NAMES` array of just the form name strings

These are spread into `ALL_FORMS_MAP_ARRAY` and `ALL_FORM_NAMES` in `all-forms.ts`.

---

## Storage Layer

The storage layer uses a **repository pattern** with TypeBox schemas for runtime validation.

### Repository Pattern

Each domain has:

- **Schema** (`*Schema.ts`) — TypeBox schema defining the table structure, primary keys, and a DI token
- **Repo** (`*Repo.ts`) — domain-specific class wrapping one or more repositories, providing save/query methods
- **Normalization** (`*Normalization.ts`, optional) — functions to clean and standardize input data (e.g., address parsing, name splitting, hash generation)

Repos get their underlying storage via dependency injection:

- **Production:** `SqliteTabularRepository` registered in `src/config/DefaultDI.ts`
- **Testing:** `InMemoryTabularRepository` registered in `src/config/TestingDI.ts`

### Junction Tables

Many-to-many relationships use junction tables with a `relation_name` column for semantic context:

```
persons_entity_junction:     person_hash_id + relation_name + cik → titles[]
persons_address_junction:    person_hash_id + relation_name + address_hash_id
companies_entity_junction:   company_hash_id + relation_name + cik → titles[]
companies_address_junction:  company_hash_id + relation_name + address_hash_id
addresses_entity_junction:   address_hash_id + relation_name + cik
phones_entity_junction:      international_number + relation_name + cik
```

Relation names are namespaced by form type (e.g., `"form-d:issuer"`, `"form-d:related-person"`, `"form-c:operator"`).

### Hash-Based Deduplication

Persons, companies, and addresses are identified by deterministic hash IDs computed from their normalized fields. This ensures the same entity inserted from different filings resolves to a single record.

---

## How to Add a New Form Type

Use Form D as a reference implementation. The files you need to create live in a form category subdirectory under `src/sec/forms/`.

### Step 1: Create the Schema (`Form_X.schema.ts`)

Define the TypeBox schema that mirrors the XML structure of the SEC filing.

```typescript
// src/sec/forms/<category>/Form_X.schema.ts

import { Type, Static } from "typebox";
import {} from /* reusable types */ "../FormSchemaUtil";

// Define sub-types for nested XML elements
const SOME_NESTED_TYPE = Type.Object({
  fieldA: Type.String(),
  fieldB: Type.Optional(Type.String()),
});

// Root form schema (the inner content)
export const FormXSchema = Type.Object({
  submissionType: Type.Union([Type.Literal("X"), Type.Literal("X/A")]),
  someField: Type.String(),
  nestedData: SOME_NESTED_TYPE,
});
export type FormX = Static<typeof FormXSchema>;

// XML wrapper schema (matches the root XML element)
export const FormXSubmissionSchema = Type.Object({
  edgarSubmission: FormXSchema, // or whatever the root XML tag is
});
export type FormXSubmission = Static<typeof FormXSubmissionSchema>;
```

**Key points:**

- Use `Type.Array()` for elements that can repeat in XML — the base `Form` class uses `extractArrayPaths()` to automatically detect these from the schema and configure the XML parser's `isArray` callback
- Use `Type.Optional()` for elements that may be absent
- Import shared types from `FormSchemaUtil.ts` (e.g., `TRUE_FALSE_LIST`, `CIK_TYPE`, `STATE_COUNTRY_CODE`)
- Export both the schema object and the `Static<>` type
- The "Submission" wrapper schema matches the outermost XML element (e.g., `<edgarSubmission>`)
- Reference the SEC's XSD files if available (some are in the same directory, like `Form_D.definition.xsd`)

### Step 2: Create the Parser (`Form_X.ts`)

```typescript
// src/sec/forms/<category>/Form_X.ts

import { Value } from "typebox/value";
import { Form } from "../Form";
import { FormX, FormXSchema, FormXSubmission, FormXSubmissionSchema } from "./Form_X.schema";

export class Form_X extends Form {
  static readonly name = "Human-Readable Form Name";
  static readonly description = "Brief description of what this form is";
  static readonly forms = ["X", "X/A"] as const; // form name and amendment variant

  static async parse(form: (typeof Form_X.forms)[number], xml: string): Promise<FormX> {
    if (!Form_X.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    const parser = Form_X.getParser(FormXSubmissionSchema);
    const json = parser.parse(xml) as FormXSubmission;
    const raw = json.edgarSubmission;
    const result = Value.Convert(FormXSchema, raw);
    return result as FormX;
  }
}

export type { FormX };
```

**How parsing works:**

1. `Form.getParser(schema)` creates an `XMLParser` (from `fast-xml-parser`) configured with `isArray` callbacks derived from the TypeBox schema — any field defined as `Type.Array()` will be treated as an array even if the XML has only one element
2. `parser.parse(xml)` converts XML to a plain JS object
3. `Value.Convert(schema, obj)` uses TypeBox to coerce values to the correct types (e.g., string `"123"` to number `123`)

### Step 3: Create the Storage Logic (`Form_X.storage.ts`)

This file transforms the parsed form data into normalized records and saves them using the storage repos.

```typescript
// src/sec/forms/<category>/Form_X.storage.ts

import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { PersonRepo } from "../../../storage/person/PersonRepo";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
// ... import other repos as needed
import { FormX } from "./Form_X.schema";

export async function processFormX({
  cik,
  file_number,
  accession_number,
  primary_doc,
  formX,
}: {
  cik: number;
  file_number: string;
  accession_number: string;
  primary_doc: string;
  formX: FormX;
}): Promise<void> {
  const companyRepo = new CompanyRepo();
  const personRepo = new PersonRepo();
  const addressRepo = new AddressRepo();

  // Extract and save entities, persons, companies, addresses, etc.
  // Use relation_name like "form-x:role-name" for junction records
  // Use hasCompanyEnding() to detect companies in person fields
  // Wrap address/phone saves in try-catch (normalization can fail on bad data)
}
```

**Patterns from Form D:**

- Instantiate repos as needed (they get their storage via DI)
- Use `"form-x:role-name"` relation names for junction records to distinguish data sources
- Detect companies in person fields with `hasCompanyEnding()` from `CompanyNormalization`
- Wrap address and phone saves in try-catch — SEC data can have garbage values
- Filter out junk data (see `isBadPersonField()` in Form_D.storage.ts for examples)
- If the form has domain-specific data (like investment offerings for Form D, crowdfunding for Form C), create storage schemas and repos for that data under `src/storage/`

### Step 4: Register the Form

**4a.** Add the form to its category's `index.ts`:

```typescript
// src/sec/forms/<category>/index.ts

import { Form_X } from "./Form_X";

export const MY_CATEGORY_FORM_NAMES_MAP = [
  // ... existing forms ...
  ...Form_X.forms.map((form) => [form, Form_X] as const),
] as const;

export const MY_CATEGORY_FORM_NAMES = MY_CATEGORY_FORM_NAMES_MAP.map(([form]) => form);
```

**4b.** If creating a new category, add it to `src/sec/forms/all-forms.ts`:

```typescript
import { MY_CATEGORY_FORM_NAMES, MY_CATEGORY_FORM_NAMES_MAP } from "./my-category";

export const ALL_FORM_NAMES = [
  // ... existing ...
  ...MY_CATEGORY_FORM_NAMES,
] as const;

const ALL_FORMS_MAP_ARRAY = [
  // ... existing ...
  ...MY_CATEGORY_FORM_NAMES_MAP,
] as const;
```

### Step 5: Wire Up Storage in the Task (if needed)

Currently, `ProcessAccessionDocFormTask` calls `formCls.parse()` but does not call the storage function — the storage function must be invoked from within the `parse()` method or wired into the task. Check the current implementation in `ProcessAccessionDocFormTask.ts` to see how your form's `processFormX()` should be called.

### Step 6: Add Domain-Specific Storage (if needed)

If the form contains data that doesn't fit into the existing `person/company/address/phone` repos (e.g., Form D has investment offerings, Form C has crowdfunding data), create new storage modules:

1. **Schema** in `src/storage/<domain>/<Domain>Schema.ts` — TypeBox schema, primary key names, DI token
2. **Repo** in `src/storage/<domain>/<Domain>Repo.ts` — save/query methods
3. **Register** the repo in `src/config/DefaultDI.ts` (SQLite) and `src/config/TestingDI.ts` (in-memory)
4. **Register** the DI token in `src/config/tokens.ts`

### Step 7: Write Tests (`Form_X.test.ts`)

```typescript
// src/sec/forms/<category>/Form_X.test.ts

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { Form_X } from "./Form_X";
import { processFormX } from "./Form_X.storage";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { PersonRepo } from "../../../storage/person/PersonRepo";
// ... import other repos

describe("Form_X", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting(); // resets all repos to in-memory
  });

  it("should parse and store form data", async () => {
    const xml = readFileSync(join(__dirname, "mock_data", "form-x", "sample.xml"), "utf-8");
    const formX = await Form_X.parse("X", xml);

    await processFormX({
      cik: 1234567,
      file_number: "test-file-1",
      accession_number: "0001234567-24-000001",
      primary_doc: "sample.xml",
      formX,
    });

    // Verify stored data
    const personRepo = new PersonRepo();
    const persons = await personRepo.getAllPersons();
    expect(persons.length).toBeGreaterThan(0);
  });
});
```

Place mock XML files in `src/sec/forms/<category>/mock_data/form-x/`. Use real filings from SEC EDGAR as test data.

### File Checklist for a New Form

```
src/sec/forms/<category>/
├── Form_X.schema.ts          — TypeBox schema matching the XML structure
├── Form_X.ts                 — Parser class (extends Form)
├── Form_X.storage.ts         — Storage logic (processFormX function)
├── Form_X.test.ts            — Tests with mock XML data
├── mock_data/form-x/*.xml    — Sample XML files from SEC EDGAR
└── index.ts                  — Updated to include Form_X in the category map

src/storage/<domain>/          — Only if new domain-specific data
├── <Domain>Schema.ts
├── <Domain>Repo.ts
└── <Domain>Normalization.ts   — Optional

src/config/
├── tokens.ts                 — New DI token (if new storage domain)
├── DefaultDI.ts              — SQLite repo registration (if new storage domain)
└── TestingDI.ts              — In-memory repo registration (if new storage domain)

src/sec/forms/all-forms.ts    — Only if new category (existing categories auto-include)
```
