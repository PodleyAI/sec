-- Truncate the derived identity tier after a normalizer change — Postgres.
--
-- Same intent as `truncate-identity-tier.sql` (which is portable DELETE-based
-- SQL that also runs on SQLite); this is the Postgres-native form. See that
-- file's header for WHY each group is here and what is deliberately spared.
--
-- Three things this does that the portable version cannot:
--
--   * ONE `TRUNCATE` naming every table. Postgres truncates them as a single
--     unit, so foreign keys between them never see a half-empty state and the
--     statement does not have to be ordered by dependency — which also means a
--     table added to the list later cannot be put in the wrong place.
--   * `RESTART IDENTITY`, so a re-extraction starts sequences from 1 instead of
--     continuing past ids that no longer exist.
--   * Schema qualification to `current_schema()` via `search_path`. An
--     unqualified name resolves through the search path, and on a deployment
--     whose path lists a staging schema first this would truncate the OTHER
--     schema's tables — the same hazard `resetAllDatabases` qualifies against.
--
-- Deliberately NOT `CASCADE`: cascade would silently truncate any table that
-- references these and is not named below, including one a superset (embarc-
-- data) added. If Postgres refuses this statement, the referencing table is the
-- answer to a real question — add it here on purpose, or drop the FK — rather
-- than letting cascade decide.
--
-- Usage:
--   psql "$SEC_PG_URL" -f scripts/sql/truncate-identity-tier.postgres.sql
--
-- Then re-extract (no version bump — `extractor_runs` is empty, so the sweep
-- re-selects every filing at the SAME version):
--   sec extractor backfill S-1
--   sec extractor backfill 424
--   sec editorial import data/editorial/family-descriptions.csv

BEGIN;

-- Pin the schema so every unqualified name below resolves to the one this
-- connection is actually deployed into, not to whatever the search path finds
-- first. Set LOCAL, so it reverts at COMMIT.
SET LOCAL search_path TO current_schema();

TRUNCATE TABLE
  -- Family tier. The link row IS the attribution here (there is no
  -- observation → link projection), so these go together or the survivors
  -- point at nothing.
  spac_sponsor_link,
  underwriter_link,
  sponsor_family_membership,
  underwriter_family_membership,
  canonical_sponsor_family_alias,
  canonical_underwriter_family_alias,
  canonical_sponsor_family,
  canonical_underwriter_family,

  -- Person canonical + link tier.
  person_role,
  person_identity_link,
  canonical_person_address,
  canonical_person_phone,
  canonical_person_alias,
  canonical_person,

  -- Company canonical + link tier. Company OBSERVATIONS survive:
  -- `normalizeCompanyName` did not change, so their `normalized_name` is still
  -- valid — only the rows keyed by the folded `company_hash_id` are rebuilt.
  company_identity_link,
  canonical_company_address,
  canonical_company_phone,
  canonical_company_alias,
  canonical_company,

  -- Person observations, and everything carrying an `observation_id` FK.
  -- These cannot outlive the observations they cite.
  beneficial_ownership,
  executive_compensation,
  related_party_transactions,
  observation_provenance,
  person_observation_titles,
  person_observations,

  -- Re-extraction gates, and the reason no version bump is needed: the forms
  -- sweep selects filings by anti-joining `extractor_runs` at the active
  -- version, so an empty table makes every filing unprocessed again at that
  -- same version. Dead letters go with it — they cite runs that no longer exist.
  extraction_dead_letter,
  extractor_runs
RESTART IDENTITY;

COMMIT;

-- `n_live_tup` drives `db status` / `db stats` row counts and is refreshed by
-- ANALYZE/autovacuum, so without this the report reads stale non-zero counts
-- for tables that are now empty.
ANALYZE;
