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
-- The COMPANY canonical tier is deliberately NOT here. `normalizeCompanyName`
-- is unchanged, `company_observations.normalized_name` is still valid, and
-- `canonical_company` is keyed on that column plus a UUID — nothing in it is
-- keyed by a normalizer that moved. (`generateCompanyHash` does fold, but no
-- table stores `company_hash_id`; it is a derived slug, not the company
-- identity key.) Wiping it would destroy `canonical_company`,
-- `company_identity_link` and both company junction tables for no reason, and
-- the only rebuild would be a full re-extraction: `sec resolve --kind company`
-- rebuilds identity links, but the company observations it reads are exactly
-- what this script keeps.
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
-- Then re-extract every person-observing extractor (see
-- PERSON_OBSERVING_EXTRACTOR_IDS) and re-import the curated data:
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
-- Scoped to the extractors that observe a person (`8-K`, `merger-proxy`, `424`
-- and the rest are untouched). Clearing every row would re-run AI extraction
-- for filings whose output this script did not delete, re-paying the model cost
-- for nothing. Keep in step with PERSON_OBSERVING_EXTRACTOR_IDS in
-- `src/storage/versioning/extractorIds.ts` — `truncateIdentityTier.test.ts`
-- fails if they diverge.
DELETE FROM extraction_dead_letter
WHERE extractor_id IN ('D', 'C', 'CFPORTAL', '1-A', '1-Z', '3', '4', '5', '144', 'S-1');
DELETE FROM extractor_runs
WHERE extractor_id IN ('D', 'C', 'CFPORTAL', '1-A', '1-Z', '3', '4', '5', '144', 'S-1');

COMMIT;
