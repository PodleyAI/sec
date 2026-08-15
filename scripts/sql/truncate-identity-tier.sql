-- Truncate the derived identity tier after a normalizer change.
--
-- Why this exists instead of a resolver version bump: a version bump is the
-- ceremony for changing a normalizer while KEEPING the rows minted under the
-- old one, so the two generations can be compared and rolled between. When the
-- old rows are disposable, wiping them is both cheaper and more honest — there
-- is no "previous" worth preserving, and leaving one behind would make
-- `version coverage` report against a generation nobody intends to keep.
--
-- What is stale, and therefore what is here:
--
--   * `person_observations.normalized_*` and every `person_hash_id` derived
--     from one. `normalizePerson` folds accents into the IDENTITY parts, so
--     each of those values is computed differently — and no SQL can recompute
--     them, because the fold is TypeScript on the extraction path. The person
--     canonical tier keyed on them goes with the observations.
--   * `canonical_*_family.normalized_name`. `normalizeFamilyName` derives the
--     key from the legal name via `companyFamilyName`, so every family key is
--     different and every family id minted under the old one is orphaned.
--
-- The COMPANY canonical tier is NOT wiped here — but it is NOT untouched
-- either, and that difference is why step 3b below is mandatory.
--
-- `normalizeCompanyName` DID change in this same release, so
-- `company_observations.normalized_name` — the column `canonical_company` is
-- keyed on, and the one `CompanyResolver`'s name fallback matches against — is
-- stale for every observation the new rules key differently. Three real
-- before/after pairs:
--
--   Churchill Capital Corp I        "Churchill Capital"             → "Churchill Capital Corp I"
--   Reinvent Technology Partners Y  "Reinvent Technology Partners"  → stays distinct from the plain name
--   Blue Acquisition Corp/Cayman    unchanged (kept "/Cayman")      → "Blue Acquisition"
--
-- The first two are the point of the release: a placeholder suffix
-- interpolated into a `RegExp` was read as a character class and deleted
-- single-letter words, so `Churchill Capital Corp I` collided with plain
-- `Churchill Capital`, and the two unrelated filers `Reinvent Technology
-- Partners` (CIK 1819848) and `Reinvent Technology Partners Y` (CIK 1828108)
-- shared ONE canonical identity.
--
-- Those rows are stale but they are also REBUILDABLE, which is exactly why
-- wiping is the wrong tool here: `normalized_name` is derived from the `name`
-- every company observation already carries, so one command recomputes it in
-- place — no re-extraction, no AI cost:
--
--   sec resolve --kind company --all --renormalize
--
-- ⚠️ THAT PASS IS REQUIRED, not optional, and nothing errors if you skip it.
-- The stale keys keep resolving, `version coverage` keeps reporting full
-- coverage, and the merged canonical identities this release exists to SPLIT
-- survive silently. It is step 3b in the list further down: after the
-- backfills, and before the alias imports — aliases are matched by canonical
-- DISPLAY NAME, so they must be imported against the re-resolved tier.
--
-- Expected residue afterwards: `canonical_company` rows minted under the
-- PREVIOUS normalized names survive the re-partition with zero identity links
-- pointing at them. They are inert, not corruption — nothing reads a canonical
-- row no link cites — and they are left in place because removing them needs a
-- reachability sweep this ceremony does not do. The visible fallout is
-- aliases: one whose target was such a row now points at an orphan, which
-- `sec canonical company alias-list --orphans` lists.
--
-- (`generateCompanyHash` does fold diacritics where `normalizeCompanyName`
-- does not, but no table stores `company_hash_id`; it is a derived slug, not
-- the company identity key, so it is no part of this.)
--
-- `observation_provenance` is scoped to `kind = 'person'` for the same reason.
-- Its person rows cannot outlive the person observations they cite; its
-- company rows cite company observations that survive.
--
-- What is deliberately NOT truncated: raw EDGAR ingest — `entities`,
-- `filings`, `cik_names`, `company_facts`, `xbrl_fact`, `processed_*`, and the
-- `spac`/`spac_deal`/`spac_event` lifecycle. None of it is keyed by a
-- normalizer, and re-downloading it costs hours against a rate limit.
--
-- ⚠️ EXPORT YOUR ALIASES FIRST. The alias tables below are hand-curated claims
-- that two canonical rows are one entity, and they are keyed by canonical UUIDs
-- that this script destroys — so they cannot be spared the way
-- `family_description` is. Export them by NAME, which survives the wipe, and
-- re-import after re-extracting:
--
--   sec canonical person            alias-list --format tsv > aliases-person.tsv
--   sec canonical company           alias-list --format tsv > aliases-company.tsv
--   sec canonical sponsor-family    alias-list --format tsv > aliases-sponsor.tsv
--   sec canonical underwriter-family alias-list --format tsv > aliases-underwriter.tsv
--
-- Usage (SQLite):
--   sqlite3 "$SEC_DB_FOLDER/$SEC_DB_NAME.sqlite" < scripts/sql/truncate-identity-tier.sql
--
-- ⚠️ On Postgres use `scripts/sql/truncate-identity-tier.postgres.sql` instead.
-- The names below are UNQUALIFIED, so on a deployment whose `search_path` lists
-- a staging or shared schema first they would resolve into the WRONG schema and
-- delete that one's identity tier irreversibly. The Postgres variant pins
-- `search_path` to `current_schema()`; that statement is not portable (sqlite3
-- rejects it) and portability is this file's only reason to exist, so the two
-- stay separate rather than one growing a dialect-specific line.
--
-- Then, in this order:
--
-- 3a. Re-extract every extractor whose output this script deleted (see
--     REKEY_REEXTRACT_EXTRACTOR_IDS). `424` is in the list for the FAMILY
--     tier, not the person one: the priced-prospectus path writes
--     `underwriter_link` rows that the family section below wipes, and nothing
--     but a re-extraction can restore them.
--   sec extractor backfill S-1
--   sec extractor backfill D
--   sec extractor backfill C
--   sec extractor backfill CFPORTAL
--   sec extractor backfill 1-A
--   sec extractor backfill 1-Z
--   sec extractor backfill 3
--   sec extractor backfill 4
--   sec extractor backfill 5
--   sec extractor backfill 144
--   sec extractor backfill 424
--
-- 3b. Re-key the COMPANY canonical tier, which this script deliberately does
--     NOT wipe but which `normalizeCompanyName` made stale. Required, cheap
--     (recomputes from stored names — no fetches, no model calls), and silent
--     if skipped. See the COMPANY paragraph above.
--   sec resolve --kind company --all --renormalize
--
-- 3c. Restore the curated data. The alias imports come LAST because they match
--     on canonical display names and must land against the re-resolved tier.
--   sec editorial import data/editorial/family-descriptions.csv
--   sec canonical person alias-import aliases-person.tsv
--   sec canonical company alias-import aliases-company.tsv
--   sec canonical sponsor-family alias-import aliases-sponsor.tsv
--   sec canonical underwriter-family alias-import aliases-underwriter.tsv
--
-- DELETE rather than TRUNCATE: SQLite has no TRUNCATE, and `DELETE FROM` with
-- no WHERE is its optimized whole-table delete. On Postgres this is slower than
-- TRUNCATE but avoids the ACCESS EXCLUSIVE lock, and these tables are small.

BEGIN;

-- ── Family tier ─────────────────────────────────────────────────────────────
-- The link row IS the attribution here (there is no observation → link
-- projection), so these go together or the survivors point at nothing.
DELETE FROM spac_sponsor_link;
DELETE FROM underwriter_link;
DELETE FROM sponsor_family_membership;
DELETE FROM underwriter_family_membership;
DELETE FROM canonical_sponsor_family_alias;
DELETE FROM canonical_underwriter_family_alias;
DELETE FROM canonical_sponsor_family;
DELETE FROM canonical_underwriter_family;

-- `family_description` is intentionally spared: it is hand-curated editorial
-- text keyed by (family_kind, normalized_name), not by a canonical id. The key
-- shape changed, so existing rows will not match until re-imported — but they
-- are the only copy, and deleting them destroys work no pipeline can rebuild.
--   sec editorial import data/editorial/family-descriptions.csv

-- ── Person canonical + link tier ─────────────────────────────────────────────
DELETE FROM person_role;
DELETE FROM person_identity_link;
DELETE FROM canonical_person_address;
DELETE FROM canonical_person_phone;
DELETE FROM canonical_person_alias;
DELETE FROM canonical_person;

-- ── Person observations, and everything keyed to one ─────────────────────────
-- These carry `observation_id` FKs, so they cannot outlive the observations.
-- `observation_provenance` is shared with the company tier, whose observations
-- survive — hence the WHERE.
DELETE FROM beneficial_ownership;
DELETE FROM executive_compensation;
DELETE FROM related_party_transactions;
DELETE FROM observation_provenance WHERE kind = 'person';
DELETE FROM person_observation_titles;
DELETE FROM person_observations;

-- ── Re-extraction gates ──────────────────────────────────────────────────────
-- Last, and the reason no version bump is needed: the forms sweep selects
-- filings by anti-joining `extractor_runs` at the active version, so clearing a
-- row makes that filing unprocessed again at the SAME version. Dead letters go
-- with it — they are keyed to runs that no longer exist.
--
-- Scoped to the extractors whose output this script actually deletes: the
-- person-observing ones, plus `424` for the family tier it wipes above (the
-- priced-prospectus path writes `underwriter_link` / `underwriter_family_
-- membership`, and a family link row IS the attribution — no observation
-- projection rebuilds it). `8-K`, `merger-proxy`, `redemption` and `loi` stay
-- untouched: nothing of theirs is deleted here, and clearing their runs would
-- re-pay AI cost for nothing. Keep in step with REKEY_REEXTRACT_EXTRACTOR_IDS
-- in `src/storage/versioning/extractorIds.ts` — `truncateIdentityTier.test.ts`
-- fails if they diverge.
DELETE FROM extraction_dead_letter
WHERE extractor_id IN ('D', 'C', 'CFPORTAL', '1-A', '1-Z', '3', '4', '5', '144', 'S-1', '424');
DELETE FROM extractor_runs
WHERE extractor_id IN ('D', 'C', 'CFPORTAL', '1-A', '1-Z', '3', '4', '5', '144', 'S-1', '424');

COMMIT;
