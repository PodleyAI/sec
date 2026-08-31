-- Truncate the derived identity tier after a normalizer change — Postgres.
--
-- Same intent as `truncate-identity-tier.sql` (which is portable DELETE-based
-- SQL that also runs on SQLite); this is the Postgres-native form. See that
-- file's header for WHY each group is here, what is deliberately spared, and
-- the ⚠️ EXPORT YOUR ALIASES FIRST warning — the alias tables below are
-- hand-curated and keyed by canonical UUIDs this statement destroys.
--
-- Three things this does that the portable version cannot:
--
--   * ONE `TRUNCATE` naming every whole-table target. Postgres truncates them
--     as a single unit, so foreign keys between them never see a half-empty
--     state and the statement does not have to be ordered by dependency —
--     which also means a table added to the list later cannot be put in the
--     wrong place.
--   * `RESTART IDENTITY`, so a re-extraction starts sequences from 1 instead of
--     continuing past ids that no longer exist.
--   * Schema qualification to `current_schema()` via `search_path`. An
--     unqualified name resolves through the search path, and on a deployment
--     whose path lists a staging schema first this would truncate the OTHER
--     schema's tables — the same hazard `resetAllDatabases` qualifies against.
--     This is why the portable file's usage block names sqlite3 only: it cannot
--     carry this statement, and Postgres users belong here.
--
-- Three tables are DELETEs rather than TRUNCATE targets because only part of
-- each is stale: `observation_provenance` is shared with the company tier, and
-- `extractor_runs` / `extraction_dead_letter` are scoped to the extractors that
-- observe a person. They run inside the same transaction, so the whole thing is
-- still one atomic ceremony.
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
-- Then re-extract every person-observing extractor and re-import the curated
-- data — see the portable file's header for the full command list. No version
-- bump: the cleared `extractor_runs` rows make those filings unprocessed again
-- at the SAME version.

BEGIN;

-- Pin the schema so every unqualified name below resolves to the one this
-- connection is actually deployed into, not to whatever the search path finds
-- first. The third argument is `is_local`, so it reverts at COMMIT.
--
-- `set_config(...)` rather than `SET LOCAL search_path TO current_schema()`:
-- SET takes identifiers and string constants, never a function call, so that
-- spelling is a syntax error. Inside this transaction it aborts every statement
-- after it and the COMMIT rolls back — the ceremony silently does nothing.
--
-- `quote_ident` because `search_path` is parsed as a list of IDENTIFIERS, so an
-- unquoted element is case-folded to lower case. A schema named `Staging`
-- (which `current_schema()` returns verbatim) would be written into the path as
-- `Staging`, resolved as `staging`, and the pin would fail open — falling back
-- to whatever the surrounding path finds first, which is the exact hazard this
-- line exists to close. `quote_ident` wraps it as `"Staging"` only when it
-- needs wrapping, so an ordinary lower-case schema is unaffected.
SELECT set_config('search_path', quote_ident(current_schema()), true);

TRUNCATE TABLE
  -- Person observations, and everything carrying an `observation_id` FK.
  -- These cannot outlive the observations they cite.
  --
  -- The COMPANY canonical tier is absent on purpose — but it is NOT untouched.
  -- `normalizeCompanyName` DID change in this release, so
  -- `company_observations.normalized_name` (the column `canonical_company` is
  -- keyed on) is stale wherever the new rules key a name differently —
  -- `Churchill Capital Corp I` no longer collapses onto `Churchill Capital`,
  -- and `Reinvent Technology Partners Y` no longer collides with `Reinvent
  -- Technology Partners`. Those rows are rebuildable rather than disposable:
  -- `normalized_name` is derived from the `name` each observation already
  -- carries, so `sec resolve --kind company --all --renormalize` recomputes and
  -- re-partitions in place with no re-extraction. ⚠️ That pass is REQUIRED
  -- after this script and nothing errors if it is skipped — the merged
  -- canonical identities simply survive. See the portable file
  -- (`truncate-identity-tier.sql`) for the full ordered command list, the
  -- before/after examples, and the zero-link residue to expect.
  beneficial_ownership,
  executive_compensation,
  related_party_transactions,
  person_observation_titles,
  person_observations
RESTART IDENTITY;

-- Provenance is keyed by (kind, observation_id) and shared with the company
-- tier, whose observations survive above. Only the person rows are orphaned.
DELETE FROM observation_provenance WHERE kind = 'person';

-- Re-extraction gates, and the reason no version bump is needed: the forms
-- sweep selects filings by anti-joining `extractor_runs` at the active version,
-- so a cleared row makes that filing unprocessed again at that same version.
-- Dead letters go with it — they cite runs that no longer exist.
--
-- Scoped to the extractors whose output this script actually deletes: the
-- person-observing ones, plus `424` for the family tier truncated above (the
-- person-observing ones exactly. `424` is NOT here — the family tier it
-- writes for is a downstream package's, with its own script and gate list.
-- (Historical note: this list used to carry it, because the
-- membership`, and a family link row IS the attribution — no observation
-- projection rebuilds it). `8-K`, `merger-proxy`, `redemption` and `loi` stay
-- untouched: nothing of theirs is deleted here, and clearing their runs would
-- re-pay AI cost for nothing. Keep in step with REKEY_REEXTRACT_EXTRACTOR_IDS
-- in `src/storage/versioning/extractorIds.ts` — `truncateIdentityTier.test.ts`
-- fails if they diverge.
DELETE FROM extraction_dead_letter
WHERE extractor_id IN ('D', 'C', 'CFPORTAL', '1-A', '1-Z', '3', '4', '5', '144', 'S-1');
DELETE FROM extractor_runs
WHERE extractor_id IN ('D', 'C', 'CFPORTAL', '1-A', '1-Z', '3', '4', '5', '144', 'S-1');

COMMIT;

-- `n_live_tup` drives `db status` / `db stats` row counts and is refreshed by
-- ANALYZE/autovacuum, so without this the report reads stale non-zero counts
-- for tables that are now empty.
ANALYZE;
