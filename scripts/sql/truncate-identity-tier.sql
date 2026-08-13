-- Truncate the derived identity tier after a normalizer change.
--
-- Why this exists instead of a resolver version bump: a version bump is the
-- ceremony for changing a normalizer while KEEPING the rows minted under the
-- old one, so the two generations can be compared and rolled between. When the
-- old rows are disposable, wiping them is both cheaper and more honest — there
-- is no "previous" worth preserving, and leaving one behind would make
-- `version coverage` report against a generation nobody intends to keep.
--
-- What changed, and therefore what is stale:
--
--   * `normalizePerson` now folds accents into the IDENTITY parts, so every
--     `person_observations.normalized_*` value and every `person_hash_id`
--     derived from one is computed differently.
--   * `generateCompanyHash` folds the non-decomposing Latin letters (ø, ł, …)
--     that NFD leaves alone, so `company_hash_id` changes for those names.
--     `normalizeCompanyName` is UNCHANGED, so `company_observations.
--     normalized_name` is still valid — company observations are kept.
--   * `normalizeFamilyName` is now derived from the legal name via
--     `companyFamilyName`, so every `canonical_*_family.normalized_name` is a
--     different key and every family id minted under the old one is orphaned.
--
-- What is deliberately NOT truncated: raw EDGAR ingest — `entities`,
-- `filings`, `cik_names`, `company_facts`, `xbrl_fact`, `processed_*`, and the
-- `spac`/`spac_deal`/`spac_event` lifecycle. None of it is keyed by a
-- normalizer, and re-downloading it costs hours against a rate limit.
--
-- Person observations ARE truncated, which means the AI extraction that
-- produced them must run again — `person_observations.normalized_*` is written
-- by the extraction path, and no SQL can recompute it (the fold is TypeScript).
-- `extractor_runs` is cleared last so the forms sweep's anti-join re-selects
-- every filing.
--
-- Usage:
--   sqlite3 "$SEC_DB_FOLDER/$SEC_DB_NAME.sqlite" < scripts/sql/truncate-identity-tier.sql
--   psql "$SEC_PG_URL" -f scripts/sql/truncate-identity-tier.sql
--
-- Then re-extract:
--   sec extractor backfill S-1
--   sec extractor backfill 424
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

-- ── Company canonical + link tier ────────────────────────────────────────────
-- Company OBSERVATIONS survive (their `normalized_name` is unchanged); only the
-- canonical rows keyed by the folded hash are rebuilt.
DELETE FROM company_identity_link;
DELETE FROM canonical_company_address;
DELETE FROM canonical_company_phone;
DELETE FROM canonical_company_alias;
DELETE FROM canonical_company;

-- ── Person observations, and everything keyed to one ─────────────────────────
-- These carry `observation_id` FKs, so they cannot outlive the observations.
DELETE FROM beneficial_ownership;
DELETE FROM executive_compensation;
DELETE FROM related_party_transactions;
DELETE FROM observation_provenance;
DELETE FROM person_observation_titles;
DELETE FROM person_observations;

-- ── Re-extraction gates ──────────────────────────────────────────────────────
-- Last, and the reason no version bump is needed: the forms sweep selects
-- filings by anti-joining `extractor_runs` at the active version, so clearing
-- it makes every filing unprocessed again at the SAME version. Dead letters go
-- with it — they are keyed to runs that no longer exist.
DELETE FROM extraction_dead_letter;
DELETE FROM extractor_runs;

COMMIT;
