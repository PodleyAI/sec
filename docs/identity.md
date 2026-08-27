# Observations, resolvers, and identity

Reference for `src/storage/observation/`, `src/storage/canonical/`,
`src/storage/versioning/`, and `src/resolver/`. Design spec:
`prd/docs/superpowers/specs/2026-05-22-sec-versioning-pr4-observation-design.md`.

---

## 1. Four tiers, in order

1. **Observation** (`src/storage/observation/`) — raw entity mentions extracted from
   filings. One row per `(extractor_id, accession_number, observation_index)`.
   `PersonObservationRepo`, `CompanyObservationRepo`. (Legacy `person/`, `company/` and
   `phone/` tables were replaced by this tier.)
2. **Canonical** (`src/storage/canonical/`) — deduplicated entities with stable UUIDs
   (`CanonicalPersonRepo`, `CanonicalCompanyRepo`), created once per resolver version, plus
   alias tables (`CanonicalPersonAliasRepo`, `CanonicalCompanyAliasRepo`) redirecting merged
   IDs.
3. **Identity link** (`PersonIdentityLinkRepo` / `CompanyIdentityLinkRepo`) — join from `observation_id` +
   `resolver_version` → `canonical_*_id`. Written inline during extraction.
4. **Junction** (`Canonical*AddressRepo`, `Canonical*PhoneRepo`) — co-occurrence of
   canonical entities with addresses/phones at a given resolver version. Two writers keep
   these rows: `EntityObserver`'s incremental +1/-1 during extraction, and
   `rebuildPersonJunctions` / `rebuildCompanyJunctions`
   (`src/resolver/rebuildJunctions.ts`), which recompute one resolver version's rows
   wholesale from the observations and their identity links. **A rebuild expects
   ingestion to be quiesced**: it purges the version's rows before writing the recomputed
   ones, so an observation recorded after it read its input but before that purge has its
   contribution deleted and not written back — self-healing on the next rebuild, wrong in
   between. The per-row lock the junction repos take does not close that window; only not
   ingesting during a rebuild does.

**`EntityObserver`** (`src/resolver/EntityObserver.ts`) is the single entry point: form
storage modules call `observePerson()` / `observeCompany()` rather than writing rows
directly. It normalizes the claim, upserts the observation, calls the resolver, writes the
identity link, and records junctions in one step.

**`PersonResolver` / `CompanyResolver`** (`src/resolver/`) — persons: CIK fast-path, then
normalized-name + issuer-CIK fallback. Companies: CIK → CRD → normalized-name cascade. Both
create a fresh canonical row on first sight and delegate alias resolution to the alias repo.

### Extension seam

**`registerResolverExtension`** (`src/resolver/resolverExtensions.ts`) is the registry every
resolver kind registers through — sec's own person / company / sponsor-family /
underwriter-family via `registerSecResolvers` (`src/config/registerResolvers.ts`), plus downstream kinds like embarc-data's
`portal-attributor`. It backs the unified `version resolver <kind>` ceremonies,
`componentRegistry`, and `resolverIds`. `ResolverId` is a runtime-validated string, not a
compile-time union.

---

## 2. Person titles and dated roles

**Titles are never stored as arrays.** The raw tier stores one row per single title in
`person_observation_titles` (PK `(observation_id, title)` — the title text is the row's
identity; source order is not stored), diffed per title on re-observation and reaped with
the observation.

The canonical tier stores one row per **tenure** in `person_role` (`PersonRoleRepo`): a
canonical person holding one canonical title (via `normalizeManagementTitles`; compound
titles split into separate rows) at one company (`company_cik`), with a required
`start_date` (earliest asserting filing date), an optional `end_date` (null = current), and
`last_seen_date` as the order-safety guard.

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

Closure is guarded by `filing_date > last_seen_date` (re-checked under a per-tenure lock), so
out-of-order replays never close a role a newer filing asserts. The full set of behaviours:

- a re-extraction that now finds a person re-opens the tenure its own accession closed,
  absorbing any interposed return tenure;
- one that no longer finds a person it alone supported deletes the phantom row;
- an earlier out-of-order roster tightens a closed tenure's end back to the first
  non-asserting filing;
- a departure-and-return yields two tenure rows.

Placeholder titles ("Signer", "Authorized Representative", "Sales Compensation Recipient",
"Connection") stay on the observation title rows but never mint tenures. Closure is
alias-aware: a roster asserting a merged person under the alias target does not close the
retired id's open tenure.

`person_role` rows are resolver-versioned like the junctions: purged by `dropPrevious`
(person), rebuilt by re-extraction replays (batch `resolve` rebuilds identity links only).

### Roster completeness

Roster closure is **completeness-gated**, and the gate lives inside
`closeUnassertedPersonRoles`, not at the call site. Each complete-roster caller hands over
a `complete` verdict — S-1 management `meta.complete && dropped === 0`, Form D
`observedRelatedPersons > 0 && droppedRelatedPersons === 0` — and always calls, so the
verdict is written down whichever way it went. A `false` verdict closes nothing.

The verdict lands in **`role_roster_completeness`** (`RoleRosterCompletenessRepo`,
`src/storage/canonical/`), keyed
`(accession_number, extractor_id, role_scope, company_cik)` — the same tuple the closure
runs over — and carrying the filing date it ran with plus the boolean. It is **not**
resolver-versioned: it is a property of the filing's extraction, so a re-key ceremony
leaves it alone and a re-extraction rewrites it.

The row exists because the decision is otherwise unrecoverable. A person the extractor
declines — junk name field, overlong name, under a confidence floor — never reaches
`observePerson`, so no observation anywhere records that the filing named them. A later
pass reading the stored observations sees a roster that looks whole, and closing from it
would end the roles of everyone the dropped row still asserted.

That later pass is `rebuildPersonRoles` (`src/resolver/rebuildPersonRoles.ts`), which
recomputes a resolver version's tenures wholesale from the observations, reading these
rows rather than re-deriving them. **Existing data carries no such rows, and a rebuild
over an un-backfilled corpus does not merely decline to close: the purge runs
unconditionally before the re-insert, so it DELETES every `end_date` the incremental path
recorded and re-opens every departure the corpus knew about.** Backfill by re-extracting
the filings before running it. Like the junction rebuilds, it also expects ingestion to be
quiesced.

```bash
sec query person-roles <cik> [--current]
```

Design spec: `prd/docs/superpowers/specs/2026-07-28-sec-dated-person-roles-design.md`.

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
sec resolve --kind person  --resolver-version 1.0.0 --all
sec resolve --kind company --resolver-version 1.0.0 --all
sec resolve --kind company --resolver-version 1.0.0 --all --renormalize
# person only — the company line refuses it
sec resolve --kind person  --resolver-version 1.0.0 --all --rebuild-roles

sec version coverage resolver person|company|sponsor-family|underwriter-family
sec version drop-previous resolver person|company
sec version drop-previous extractor <extractor-id>
```

`--renormalize` recomputes the derived identity columns from the name as filed **before**
resolving, so a normalizer change takes effect without re-extraction. It calls the same
helpers the extraction path writes with (`normalizePersonNameParts`, `normalizeCompanyName`)
precisely so a second implementation cannot drift and re-key half the tier to a generation
nothing else produces.

`sec resolve` then recomputes the tables derived from the links it just wrote — **the
resolved kind's tables and no others**. A person run rebuilds the person junctions (and,
on request, `person_role`); a company run rebuilds the company junctions. The junctions are
grouped afresh from `(observation → identity_link → canonical_id)` at that version, because
a re-resolve otherwise leaves them counted against the previous pass's canonical ids. Each
projection is isolated the way a single row is: one that raises — a link whose observation
is gone, an observation whose `filings` row is gone — is reported on its own line and the
others still run. Both of those raises land before the projection purges anything, so a
failure of that kind leaves its table exactly as it was rather than emptied.

The per-kind scoping is load-bearing, not tidiness. A resolver version is a per-kind
number that carries no per-kind name, and `db setup` seeds **every** resolver id at
`1.0.0`, so on a default install the person and company versions are the same string:
an off-kind rebuild does not find an empty table at that version, it finds the other
tier's live rows and recomputes them from links the run never wrote.

`--rebuild-roles` adds `person_role` to that set, on `--kind person` only — asking for it
on a company run is **refused**, because `person_role` is the person tier's and a company
pass writes no link that feeds it. It is off by default even on a person run because it is
not symmetric with the junctions: it **deletes** every tenure at the version before
re-deriving them, and it can only re-close a tenure whose filing recorded a complete roster
in `role_roster_completeness`. Over a corpus ingested before those rows were written it
finds no complete roster, closes nothing, and so re-opens every departure the incremental
path had recorded. Re-extract the roster filings first.

### The family tiers

| kind                 | canonical                      | membership                      | per-filing link     |
| -------------------- | ------------------------------ | ------------------------------- | ------------------- |
| `sponsor-family`     | `canonical_sponsor_family`     | `sponsor_family_membership`     | `spac_sponsor_link` |
| `underwriter-family` | `canonical_underwriter_family` | `underwriter_family_membership` | `underwriter_link`  |

There is **no observation → identity-link table here: the per-filing link row IS the
family-tier fact**, keyed `(accession_number, extractor_id, observation_index)` with
`resolver_version` as a plain column. Exactly one row exists per fact, carrying whichever
version last wrote it, and **coverage** is the share of link rows already attributed at the
target version (`1.0` = every recorded family fact re-resolved).

> **`drop-previous` is deliberately NOT supported for the family kinds** and errors.
> On the person/company tier a purge is safe because identity links are _derived_: the
> observation rows survive it, so `sec resolve` rebuilds every link it removed. The family
> tier has no such backstop — the link row **is** the attribution — and batch `sec resolve`
> refuses family kinds, so nothing can rebuild what a purge deletes. Recovery would mean
> re-extracting every affected S-1/424 and re-paying the AI cost. The ceremony is symmetric
> in shape across the four kinds but not in consequence, and the asymmetry is invisible at
> the call site, so the destructive half stays unregistered until a family `resolve` exists.

Batch `sec resolve` still refuses any kind outside its `person|company` allow-list, but the
reason it **had** to has been removed: the family key used to come from the **common** name
the AI extractor emitted, which never reached the observation row, so a batch pass had
nothing faithful to re-partition from. `normalizeFamilyName` now derives it from the
**legal** name via `companyFamilyName` — a value every observation already carries — so a
re-partition is a re-computation. Wiring the family-tier `resolve` (and the `drop-previous`
it gates) is what remains.

### Alias management

```bash
sec canonical suggest-aliases --kind company [--format tsv]

sec canonical <kind> alias "<from-name>" "<into-name>" --reason "merged duplicate"
sec canonical <kind> alias-remove "<name>"
sec canonical <kind> alias-list [--orphans] [--format tsv]
sec canonical <kind> alias-import <file.tsv>
```

Kinds: `person`, `company`, `sponsor-family`, `underwriter-family`. Exports are **TSV, not
CSV**, because canonical names routinely contain commas (`Keefe, Bruyette & Woods, Inc.`).
`alias-import` resolves each pair by NAME and reports each pair it cannot place without
abandoning the rest — a name whose canonical row has not been re-extracted yet is an expected
partial failure, not a reason to lose the other forty.

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
sec canonical company alias "Soren Skou Holdings LLC" "Søren Skou Holdings LLC"
```

Closing the gap means folding inside `normalizeCompanyName`, which is a re-key of every
company observation ever written — now affordable via
`sec resolve --kind company --all --renormalize`. The fold is still not applied;
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
sec resolve --kind person  --all
sec resolve --kind company --all
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

**What is actually stale** is the PERSON identity generation and the FAMILY keys:
`person_observations.normalized_*` and every `person_hash_id` derived from one (the fold went
into the identity parts, and no SQL can recompute it), plus every
`canonical_*_family.normalized_name`. The scripts clear those, the person canonical tier keyed
on them, and everything carrying a person `observation_id`.

**The COMPANY canonical tier is spared from the wipe — but it is not untouched.**
`normalizeCompanyName` changed in the same release, so `company_observations.normalized_name`
is stale wherever the new rules key a name differently. Those are the merged canonical
identities the release exists to split. It is spared anyway because those rows are
**rebuildable, not disposable**: `--renormalize` recomputes them in place with no
re-extraction and no AI cost. Wiping instead would destroy `canonical_company`,
`company_identity_link` and the company junctions and leave a full re-extraction as the only
rebuild.

> ⚠️ **The renormalize pass is required, and nothing errors if it is skipped.** The stale keys
> keep resolving, `version coverage` keeps reporting full coverage, and the merged identities
> survive silently. Expect residue: canonical rows minted under previous normalized names
> survive with zero identity links pointing at them. They are inert, not corruption; the
> visible fallout is aliases whose target became one of them, listed by
> `sec canonical company alias-list --orphans`.

`observation_provenance` is scoped `WHERE kind = 'person'` because its company-kind rows cite
observations that survive and are keyed by observation id rather than by any normalized value.

`extractor_runs` / `extraction_dead_letter` are cleared only for the extractors whose output
the scripts actually delete (`REKEY_REEXTRACT_EXTRACTOR_IDS` in
`src/storage/versioning/extractorIds.ts`), so the forms sweep's anti-join re-selects exactly
those filings at the **same** version. Clearing every row would re-run `8-K` redemption/LOI
detection and `merger-proxy` extraction — AI passes whose output the script never deleted.

That set is the person-observing extractors **plus `424`**, and the `424` is not an oversight:
`runOfferingSections` writes `underwriter_link` / `underwriter_family_membership` from the
priced path under extractor id `424`, and a family link row **is** the attribution.
`truncateIdentityTier.test.ts` fails if the SQL and the constant drift, and separately asserts
that a script wiping `underwriter_link` re-extracts `424`.

Raw EDGAR ingest is left alone — nothing in `entities`, `filings`, `cik_names`,
`company_facts` or `xbrl_fact` is keyed by a normalizer, and re-downloading it costs hours
against the rate limit. `family_description` is spared too: it is hand-curated and its
`(family_kind, normalized_name)` key changed, so re-import it rather than lose it.

### Two files, one per backend, and they are not interchangeable

`truncate-identity-tier.sql` is portable DELETE-based SQL for **sqlite3 only**; its table
names are unqualified, so running it through `psql` on a deployment whose `search_path` lists
a staging schema first would delete that schema's identity tier irreversibly.
`truncate-identity-tier.postgres.sql` pins the schema with
`SELECT set_config('search_path', current_schema(), true)` (which sqlite3 rejects, hence the
split) and adds `TRUNCATE ... RESTART IDENTITY`. The two name the same table set, enforced by
test.

The pin is `set_config`, **not** `SET LOCAL search_path TO current_schema()`: `SET` takes
identifiers and string constants, never a function call, so that spelling is a syntax error
that aborts every following statement and rolls back the `COMMIT` — the ceremony prints errors
and wipes nothing. A test pins the accepted spelling directly.

### The ceremony

> ⚠️ **Export your aliases first — they are wiped and cannot be reconstructed.** Alias rows are
> hand-curated claims keyed by the canonical UUIDs the wipe destroys, so they cannot be spared
> the way `family_description` is.

```bash
# 1. Export the hand-curated aliases (names, which survive the wipe)
sec canonical person             alias-list --format tsv > aliases-person.tsv
sec canonical company            alias-list --format tsv > aliases-company.tsv
sec canonical sponsor-family     alias-list --format tsv > aliases-sponsor.tsv
sec canonical underwriter-family alias-list --format tsv > aliases-underwriter.tsv

# 2. Wipe (SQLite; on Postgres use the .postgres.sql variant)
sqlite3 "$SEC_DB_FOLDER/$SEC_DB_NAME.sqlite" < scripts/sql/truncate-identity-tier.sql

# 3a. Re-extract EVERY extractor whose output the wipe deleted, not just S-1.
#     424 is in the list for the FAMILY tier (underwriter links), not persons.
for id in S-1 D C CFPORTAL 1-A 1-Z 3 4 5 144 424; do sec extractor backfill "$id"; done

# 3b. Re-key the COMPANY tier the wipe spared but the normalizer made stale.
#     Required; cheap; silent if skipped. Must precede the alias imports.
sec resolve --kind company --all --renormalize

# 4. Restore the curated data
sec editorial import data/editorial/family-descriptions.csv
sec canonical person             alias-import aliases-person.tsv
sec canonical company            alias-import aliases-company.tsv
sec canonical sponsor-family     alias-import aliases-sponsor.tsv
sec canonical underwriter-family alias-import aliases-underwriter.tsv
```

Step 3b takes no `--resolver-version`: it defaults to the **active slot** ("next if a dev
cycle exists, else current"), the same rule `version coverage` reads.
