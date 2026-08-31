# Observations and identity

Reference for `src/storage/observation/`, `src/storage/versioning/`, and `src/resolver/`.

**This package records observations; it does not resolve them.** An observation is one
entity mention, in one filing, as an extractor read it. Deciding which mentions are the same
person or the same company is judgement about human text, and the canonical tier that holds
those decisions is a downstream package's — see its own `docs/identity.md`. What is here is
the tier every such decision is derived from, plus the normalizers, the roster-completeness
verdict, and the version slots, all of which both packages share.

---

## 1. The observation tier

**Observation** (`src/storage/observation/`) — raw entity mentions extracted from filings.
One row per `(extractor_id, accession_number, observation_index)`. `PersonObservationRepo`,
`CompanyObservationRepo`. (Legacy `person/`, `company/` and `phone/` tables were replaced by
this tier.)

Built on it, downstream: the **canonical** rows with their stable UUIDs and aliases, the
**identity link** joining `observation_id` + `resolver_version` → `canonical_*_id`, and the
**junction** tables counting canonical entities against addresses and phones. All three are
derived from the rows here by a later pass, which is what makes a replay land the same
result whatever order the filings arrived in.

The seam between the two is `observation_id`. Nothing here reads a canonical id, and the
rows keyed to one are reached only through the hooks and registries below.

**`EntityObserver`** (`src/resolver/EntityObserver.ts`) is the single entry point: form
storage modules call `observePerson()` / `observeCompany()` rather than writing rows
directly. It normalizes the claim and upserts the observation and its titles — and that is
all it does. Everything keyed to a canonical id (the link, the junction counts, the dated
tenures) is derived from those stored rows by a later pass, so a replay lands the same rows
whatever order the filings arrived in. Build one with `buildObserveOnlyEntityObserver()`.

The one judgement on that path a later pass cannot reconstruct is roster completeness, which
is why `closeUnassertedPersonRoles` exists and why it records its verdict either way: a
person the extractor declined leaves no observation, so nothing else remembers the filing
named them.

### Reaping

A re-extraction that yields fewer entities than the last one leaves orphan observations
behind. `reapStaleObservations` deletes them, and hands each one to every hook registered
through **`registerObservationReapHook`** (`src/resolver/observationReapHooks.ts`) — the
seam a package holding observation-keyed rows of its own joins through. Nothing in this
package registers one.

A hook that fails **takes the reap with it**, deliberately. The reap is the last moment
anything can name the observation, so a row the hook failed to remove is keyed to something
nothing can find again. Raising leaves the filing to a dead letter and a re-run, which is
recoverable in a way a silent orphan is not.

### Person names: filed and normalized

The two representations stored here have deliberately different contracts:

- `person_observations.first_name/middle_name/last_name/suffix` record the extractor's
  structured reading of what was filed. Form C additionally keeps every original signature
  string in `source_context.filed_names` because its XML supplies an unstructured signature.
- `person_observations.normalized_*` are identity-key fields. They remove signature markers,
  identity-neutral punctuation and credentials; they are not presentation text.

The third — `canonical_person.display_*`, the cleaned human-readable form — is the canonical
tier's, and so are the rules by which a resolver decides two of these rows are one person.

### Extension seam

**`registerResolverExtension`** (`src/resolver/resolverExtensions.ts`) is the registry every
resolver kind registers through. This package registers **none** — person, company,
sponsor-family and underwriter-family all arrive from the package that owns those tiers,
alongside its own kinds like `portal-attributor`. The registry backs the unified
`version resolver <kind>` ceremonies, `componentRegistry`, and `resolverIds`; `ResolverId`
is a runtime-validated string, not a compile-time union.

The consequence worth stating: a binary that registers no kinds has no kinds for those
ceremonies to name. `version coverage resolver person` works in a binary that brings the
tier with it, and finds nothing in one that does not.

---

## 2. Person titles and dated roles

**Titles are never stored as arrays.** The raw tier stores one row per single title in
`person_observation_titles` (PK `(observation_id, title)` — the title text is the row's
identity; source order is not stored), diffed per title on re-observation and reaped with
the observation.

The canonical tier — a downstream package's — stores one row per **tenure** in
`person_role`: a canonical person holding one canonical title at one company
(`company_cik`), with a required `start_date` (earliest asserting filing date), an optional
`end_date` (null = current), and `last_seen_date` as the order-safety guard. The rules below
are here because they are what an extractor in THIS package has to get right for that
derivation to be sound; the table and the pass that fills it are described downstream.

A tenure's `end_date` is set only by inference: a later filing that no longer mentions the
person reads as evidence they left. That inference is sound for a list that names everyone
holding a role — an S-1 management section names every officer and director, so a later one
omitting Jane Smith says she left — and it is nonsense for a list that only names whoever
happened to appear — a Form D signature block names whoever signed, so omitting her says
nothing. `role_scope` is the tag that tells the two apart: it names which list inside the
form a person was read from (`form-d:related-person`, `form-d:signature`, `s1:management`,
`section16:reporting-owner`, `cfportal:contact`, …), and tenures are keyed
`(extractor_id, role_scope)` so one list can never close another's tenures.

There are two kinds:

- **Complete rosters** name everyone holding the role, so absence is evidence of departure.
  These call `observer.closeUnassertedPersonRoles(...)` after their person loop — today,
  Form D related persons (`form-d:related-person`) and the S-1 management section
  (`s1:management`).
- **Assert-only lists** name only whoever happened to appear — signatures, sales-comp
  recipients, Section 16 owners, CFPORTAL contacts and owners, and so on — so absence proves
  nothing. These never call closure.

A claim participates in role-tenure tracking at all only when it carries `filing_date`,
`source_filing_issuer_cik`, and a `role_scope`.

Closure is guarded by `filing_date > last_seen_date`, so out-of-order replays never close a
role a newer filing asserts, and a departure-and-return yields two tenure rows.

Placeholder titles ("Signer", "Authorized Representative", "Sales Compensation Recipient",
"Connection") stay on the observation title rows but never mint tenures.

### Roster completeness

Roster closure is **completeness-gated**, and the gate lives inside
`closeUnassertedPersonRoles`, not at the call site. Each complete-roster caller hands over
a `complete` verdict — S-1 management `meta.complete && dropped === 0`, Form D
`observedRelatedPersons > 0 && droppedRelatedPersons === 0` — and always calls, so the
verdict is written down whichever way it went. A `false` verdict closes nothing.

The verdict lands in **`role_roster_completeness`** (`RoleRosterCompletenessRepo`,
`src/storage/roster/`), keyed
`(accession_number, extractor_id, role_scope, company_cik)` — the same tuple the closure
runs over — and carrying the filing date it ran with plus the boolean. It is **not**
resolver-versioned: it is a property of the filing's extraction, so a re-key ceremony
leaves it alone and a re-extraction rewrites it.

The row exists because the decision is otherwise unrecoverable. A person the extractor
declines — junk name field, overlong name, under a confidence floor — never reaches
`observePerson`, so no observation anywhere records that the filing named them. A later
pass reading the stored observations sees a roster that looks whole, and closing from it
would end the roles of everyone the dropped row still asserted.

That later pass is the downstream `rebuildPersonRoles`, which recomputes a resolver
version's tenures wholesale from the observations, reading these rows rather than
re-deriving them. **Existing data carries neither these rows nor
`person_observations.role_scope`, and a rebuild over such a corpus does not merely decline
to close.** Both columns were added with no backfill, so every older observation carries a
null scope, the rebuild's three-part gate skips every one of them, and the purge has
already run: the version's `person_role` ends up **empty**, for every CIK. (Missing
completeness rows alone are the milder half: those re-open every departure the corpus knew
about, and heal as filings are re-extracted.)

### Recovering a corpus that predates the two columns

The two halves recover differently, and only one costs a model call.

**Completeness is free, and must be recovered FIRST.** `closeUnasserted` stamps
`end_accession` alongside every `end_date`, and it only ever ran for a roster the
extraction declared complete — so an end-dated tenure _is_ the record that the filing it
names enumerated the whole roster. `extractor reconstruct-roster-completeness` reads them
back into `role_roster_completeness`: one read of each table, one write per missing
decision, no re-extraction. It is idempotent, never overwrites a decision already recorded,
and must be run **before** the rebuild, which replaces the very tenures it reads.

It reads `person_role`, so it ships with the package that owns that table and runs from
that binary — on the `extractor` group defined here, beside `backfill`, because `backfill`
is the alternative an operator is choosing between.

It cannot recover a `complete: false` verdict, nor a `complete: true` one for a filing
whose roster nobody had left — both closed nothing, so both left no trace. Absence is
already how a rebuild reads "not known to be complete", so each omission declines to close
a tenure rather than inventing a departure.

**Scope is not free: re-extract.** `sec extractor backfill <id>` for the person-observing
extractors. **Do not derive `role_scope` from `person_role` instead.** It looks equally
free and is not: an observation whose titles all filtered away minted no tenure, so it
would keep a null scope, drop out of the rebuild, and its roster would stop being marked
incomplete — inventing departures, which is the error direction none of this tolerates.

**The rebuild snapshots before it purges**, to a file under `.sec-snapshots/`. Keep it
until the result checks out; the downstream doc describes it.

---

## 3. Versioning and slot ceremonies

`VersionRegistry` (`src/storage/versioning/`) owns the slots. Each extractor and resolver
has three: `previous`, `current`, `next`.

| Ceremony       | Effect                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- |
| `startDev`     | Opens a dev cycle (populates `next`; patch bumps update `current` in place)              |
| `promote`      | Rotates `next → current → previous`. Major bumps enforce a coverage gate                 |
| `rollback`     | Swaps `previous` and `current`                                                           |
| `dropNext`     | Discards an in-flight cycle                                                              |
| `dropPrevious` | Clears `previous` and purges its data (extractor runs, or resolver links/canonical rows) |

```bash
sec version coverage resolver <kind>
sec version drop-previous resolver <kind>
sec version drop-previous extractor <extractor-id>
```

The slots and these ceremonies are this package's; the **kinds** they name are not. Nothing
here calls `registerResolverExtension`, so `<kind>` resolves only in a binary that brings a
resolver tier with it (see [Extension seam](#extension-seam)). `dropPrevious` for a resolver
kind purges that kind's links and canonical rows through the extension, which is why the
package owning them decides whether a purge is even recoverable — for the family kinds it
is not, and the ceremony is deliberately left unregistered there.

The passes that write those rows — `resolve --kind person|company [--renormalize]`, the
junction and `person_role` rebuilds, the alias ceremonies, and the family tiers — are all
described in the downstream `docs/identity.md`.

---

## 4. Normalizers

### `companyFamilyName` — "are these the same house"

`src/storage/company/CompanyFamilyName.ts`. Answers a different question from
`normalizeCompany`, which answers "are these the same legal entity". It strips the trailing
legal form, series marker (roman numeral or year), parenthetical jurisdiction, EDGAR's
state-of-incorporation marker, an `Entities affiliated with` bloc prefix, and a conjunction
stranded by an `& Co.` — so `Churchill Sponsor XIII LLC` and `Churchill Sponsor XIV LLC` are
one family, and `Morgan Stanley` needs no alias to meet `Morgan Stanley & Co.`

**It deliberately does NOT strip business-line words.** Dropping `Capital`, `Ventures`,
`Partners`, `Group` reads as harmless boilerplate and is not: those words routinely separate
two real houses (`Acme Capital` / `Acme Ventures` can be unrelated firms). The asymmetry
decides it — an **over**-merge silently attributes one house's deals to another and leaves no
trace, while an **under**-merge is visible as two families and costs one alias.

The **series marker** goes wherever it sits, not only at the end — sponsors serialize a
vehicle wherever the name reads best (`Southern Cross Acquisition I Sponsor Corp.`,
`Osprey Acquisition III, Sponsor LLC`, `CGC III Sponsor DirectorCo LLC` are all real names a
tail-only strip split into one family each) — **except** when dropping it would leave a
single generic vehicle word standing as the whole house name. `Fund II`, `Partners III`,
`Ventures 2021` name no house at all and the numeral is their only distinguishing token, so
they keep it (`fund-ii` ≠ `fund-iii`) while anything still carrying a house token does not
(`Churchill Sponsor XIII LLC` → `churchill-sponsor`, `WAVE Equity Fund II, L.P.` →
`wave-equity-fund`). `GENERIC_VEHICLE_WORDS` is the vocabulary answering "would the surviving
name still name a house" — a **floor, never a strip list**: no word in it is ever dropped.

Mid-name the rule is **stricter**, because position is no longer evidence: only well-formed
roman numerals, never a bare number (`civil`, `dim`, `mild` and `vivid` are all runs of
`ivxlcdm`; `Route 66 Ventures` would lose its `66`), and never the first or last token (a
leading numeral is the house's own name, as in `V Capital`; the last position already answered
to the tail rule and its generic-vehicle floor).

Stripping is **token-exact**, so `DirectorCo` is not gutted by the `co` it ends in, and it
never empties a name, so `III LLC` is kept whole rather than colliding with every other such
name. `Citigroup Global Markets Inc.` does **not** unify with `Citigroup` — a known gap;
stripping `Global` would fix it and corrupt `Fundamental Global Inc.`, the worse error.

> ⚠️ Changing this function **re-keys the family tier**. Keys derive from the legal name every
> observation carries, so they are rebuildable in principle — but no batch family `resolve`
> exists yet, so in practice a re-key means re-extracting the affected S-1/424 filings.

> ⚠️ It is **not** an identity key. It throws away exactly what separates two vehicles of one
> sponsor, so using it to de-duplicate entities merges every SPV a sponsor ever formed.
> `CompanyFamilyName.test.ts` pins the contract: two funds of one family are ONE family and
> TWO companies.

### Endings are matched as literals, not as patterns

`COMPANY_ENDINGS_TO_STRIP` holds word-shaped legal forms (`INC`, `CORP`, …) and is escaped
before it reaches a `RegExp`. Phrase and placeholder suffixes live in
`LITERAL_SUFFIXES_TO_STRIP` and are matched by text compare. Keeping the two apart — and both
apart from `CANONICAL_ENDINGS`, which really is regex source — is what stops a literal being
read as a pattern.

It was not: the placeholder `[related person is an entity]` was interpolated into
`new RegExp("\\b" + ending + "\\b$")`, where its brackets are a **character class**, so any
name ending in a single-letter word drawn from `{r,e,l,a,t,d,p,s,o,n,i,y}` had that word
deleted. `Churchill Capital Corp I` normalized to `Churchill Capital`; 44 of the 816 SIC-6770
registrants lost their series marker; and `Reinvent Technology Partners` (CIK 1819848, now
Joby) and `Reinvent Technology Partners Y` (CIK 1828108, now Hippo) collided on one canonical
identity. The same list backs `hasCompanyEnding`, the **person-vs-company discriminator** on
Forms D / C / 1-A / 1-Z / 3 / 4 / 5 / 144, which read `Klein Michael S` as a company; and the
class contained a literal space, so `hasCompanyAnywhere` returned true for every multi-word
string.

### EDGAR's state-of-incorporation suffix

EDGAR appends `/DE`, `/CI` or `/Cayman` to a conformed name when it needs to disambiguate one.
`stripEdgarJurisdictionSuffix` (`src/util/dataCleaningUtils.ts`) drops it before **both**
normalizers tokenize. Not cosmetic on either tier: the family key kept the marker as a token,
so `Churchill Capital Corp XII` keyed `churchill-capital` while its own
`Churchill Capital Corp IX/Cayman` keyed `churchill-capital-corp-cayman`; and
`normalizeCompanyName` could not reach the legal form behind it, since `\bCORP\b$` does not
match `Blue Acquisition Corp/Cayman`, so that name minted a second canonical company. The rule
fires only on a trailing `/<alphabetic token ≤ 8>` with an optional trailing slash and never
empties a name; across the 816 SIC-6770 registrants it matches exactly 10 names.

### Diacritics

`foldDiacritics` (`src/util/dataCleaningUtils.ts`) folds accented Latin letters to their ASCII
base, so a filer writing `Jörg Müller` in one filing and `Jorg Muller` in the next names one
person. Two passes, because one does not cover the alphabet: NFD splits a letter from its
combining mark, and an explicit map handles `ø ł đ ð þ ß æ œ …`, which carry the mark inside
the glyph. An NFD-only fold leaves those for the caller's `[^a-z]` filter, which turns `Søren`
into `s ren` and **deletes** the `Ł` in `Łukasz`. Case is preserved; callers building a key
lowercase themselves.

**The person tier folds; the company tier does not.** For persons the fold is applied to the
identity **parts**, not just the hash, so `person_hash_id` and the `normalized_*` columns
`personKey` matches on cannot drift apart. The name as filed keeps its accents in
`first_name` / `last_name`.

On the company side only `generateCompanyHash` folds, and that is a **derived slug nothing
persists** — no table stores `company_hash_id`, and its one in-repo consumer is the eval
scorer's match key. The key the company tier actually matches on is
`company_observations.normalized_name`, written by `normalizeCompanyName`, which does not
fold. So `Søren Skou Holdings LLC` and `Soren Skou Holdings LLC` still mint two canonical
companies. The remedy is an explicit alias:

```sh
# from the package that owns the canonical tier
canonical company alias "Soren Skou Holdings LLC" "Søren Skou Holdings LLC"
```

Closing the gap means folding inside `normalizeCompanyName`, which is a re-key of every
company observation ever written — now affordable via
the downstream `resolve --kind company --all --renormalize`. The fold is still not applied;
`CompanyNormalization.test.ts` pins the gap so it cannot land as a one-line change with no
migration.

### Address normalization: a blank city is stored blank

`AddressSchema.city` is **nullable**, and `normalizeAddress` never invents a value. The
ownership forms (3/4/5/144) routinely put the country in `stateOrCountry` and leave the city
blank; the country NAME used to stand in, which is not a city and — since
`generateAddressHash` joins every non-empty column — went straight into `address_hash_id`. It
also mis-resolved the US territories: `COUNTRY_STATE_CODE_ARRAY` carries `AS`/`GU`/`MP`/`VI`/
`UM` twice, as a US subdivision before the country row, so a `find` on the ISO code gave an
American Samoa address the city `"UNITED STATES"`.

The rule now: a **street** is what makes an address usable, a city is still required for a
**US** address, and a foreign one is kept with a null city.

> ⚠️ Changing it re-keys every address whose city was fabricated — non-US addresses with a
> blank filer-reported city, and nothing else. **Free**: every writer on this path is
> deterministic, so there is no AI cost and no version bump. Tables carrying the old key:
> `addresses`, `addresses_entity_junction`, `addresses_entity_history_junction`,
> `canonical_person_address`, `canonical_company_address`, and the `raw_address_id` column on
> both observation tables.

```bash
sec db setup                       # relaxes the NOT NULL
sec sync submissions submissions
for id in D C 1-A 1-K 1-Z CFPORTAL 3 4 5 144; do sec extractor backfill "$id"; done
# ...then, from the package that owns the canonical tier:
#   resolve --kind person  --all
#   resolve --kind company --all
```

**Do not delete the old rows.** `addresses_entity_history_junction` is temporal and pins the
old hash forever, correctly, as a record of what was stored; the orphaned `addresses` rows are
inert residue.

> ⚠️ Skipping the backfill/resolve steps is **silent**: the fabricated cities keep resolving,
> nothing errors, and no coverage number drops. Size the job first with
> `SELECT COUNT(*) FROM addresses WHERE country_code <> 'US' AND city IS NOT NULL` and eyeball
> the result for country display names.

---

## 5. Re-keying without a version bump

A resolver version bump preserves rows minted under the old normalizer so the two generations
can be compared and rolled between. When the old rows are disposable, wiping is cheaper and
more honest — `version coverage` would otherwise report against a generation nobody intends
to keep.

**This package's script is one half of that ceremony.**
`scripts/sql/truncate-identity-tier.sql` wipes the person OBSERVATIONS and everything keyed
to one. The person canonical tier keyed to THEM is a downstream package's, wiped by its
paired script; the sponsor/underwriter family tier is a third script, re-keyed by a
different normalizer change and deliberately not part of the pair. Run the pair together —
no foreign key enforces it, so a half-run leaves rows citing rows that are gone.

**What is stale, and therefore what is here:** `person_observations.normalized_*` and every
`person_hash_id` derived from one. `normalizePerson` folds accents into the identity parts,
so each of those values is computed differently, and no SQL can recompute them — the fold is
TypeScript on the extraction path.

**The COMPANY observations are spared.** `normalizeCompanyName` changed in the same release,
so `company_observations.normalized_name` is stale wherever the new rules key a name
differently — those are the merged canonical identities the release exists to split. They
are spared anyway because they are **rebuildable, not disposable**: `normalized_name` derives
from the `name` each observation already carries, so `resolve --kind company --all
--renormalize` recomputes it in place with no re-extraction and no AI cost.

> ⚠️ **That pass is required, and nothing errors if it is skipped.** The stale keys keep
> resolving, `version coverage` keeps reporting full coverage, and the merged identities
> survive silently. It belongs to the package that owns the canonical tier, and its script
> prescribes it — but the reason it is needed is the normalizer change recorded here.

`observation_provenance` is scoped `WHERE kind = 'person'` because its company-kind rows cite
observations that survive and are keyed by observation id rather than by any normalized value.

`extractor_runs` / `extraction_dead_letter` are cleared only for the extractors whose output
this script actually deletes (`REKEY_REEXTRACT_EXTRACTOR_IDS` in
`src/storage/versioning/extractorIds.ts`), so the forms sweep's anti-join re-selects exactly
those filings at the **same** version. Clearing every row would re-run `8-K` redemption/LOI
detection and `merger-proxy` extraction — AI passes whose output the script never deleted.

That set is the person-observing extractors **exactly**. `424` is not among them: it observes
no person, and the family tier its priced path writes for is re-keyed by its own script with
its own gate list. Gating it from here would re-extract every priced prospectus for nothing.
`truncateIdentityTier.test.ts` fails if the SQL and the constant drift, and separately
asserts that neither the family tables nor the person canonical tables are named here.

Raw EDGAR ingest is left alone — nothing in `entities`, `filings`, `cik_names`,
`company_facts` or `xbrl_fact` is keyed by a normalizer, and re-downloading it costs hours
against the rate limit.

### Two files, one per backend, and they are not interchangeable

`truncate-identity-tier.sql` is portable DELETE-based SQL for **sqlite3 only**; its table
names are unqualified, so running it through `psql` on a deployment whose `search_path` lists
a staging schema first would delete that schema's observations irreversibly.
`truncate-identity-tier.postgres.sql` pins the schema with
`SELECT set_config('search_path', quote_ident(current_schema()), true)` (which sqlite3
rejects, hence the split) and adds `TRUNCATE ... RESTART IDENTITY`. The two name the same
table set, enforced by test.

The pin is `set_config`, **not** `SET LOCAL search_path TO current_schema()`: `SET` takes
identifiers and string constants, never a function call, so that spelling is a syntax error
that aborts every following statement and rolls back the `COMMIT` — the ceremony prints errors
and wipes nothing. A test pins the accepted spelling directly.

### The ceremony

> ⚠️ **Export your aliases first — before running either half.** No alias table is in this
> script any more, but the paired one destroys them all: they are hand-curated claims keyed
> by canonical UUIDs that script wipes. Its header carries the export commands.

```bash
# 1. Wipe both halves (SQLite; on Postgres use the .postgres.sql variants)
sqlite3 "$SEC_DB_FOLDER/$SEC_DB_NAME.sqlite" < scripts/sql/truncate-identity-tier.sql
#    ...then the downstream truncate-canonical-tier.sql against the same file.

# 2. Re-extract EVERY extractor whose output the wipe deleted, not just S-1.
for id in S-1 D C CFPORTAL 1-A 1-Z 3 4 5 144; do sec extractor backfill "$id"; done
```

Re-resolving, the mandatory company renormalize, and the alias imports follow, from the
package that owns the canonical tier. Its `docs/identity.md` carries the full ordered list.
