/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { setupAllDatabases } from "../config/setupAllDatabases";
import { CanonicalSponsorFamilyRepo } from "../storage/canonical/CanonicalSponsorFamilyRepo";
import { CanonicalSponsorFamilyAliasRepo } from "../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import { _internal } from "./canonicalFamilyMigrate";

const { SPONSOR_TARGET, migrateUppercase } = _internal;

async function seed(id: string, displayName: string, normalized: string, version = "1.0.0") {
  await new CanonicalSponsorFamilyRepo().create({
    canonical_sponsor_family_id: id,
    resolver_version: version,
    display_name: displayName,
    normalized_name: normalized,
    created_at: new Date().toISOString(),
  });
}

describe("migrateUppercase (sponsor-family, repository fallback)", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("UPPER-folds a lowercase row when --apply is passed", async () => {
    await seed("fam-lower", "acme sponsor", "acme sponsor");

    const dryRun = await migrateUppercase(SPONSOR_TARGET, {
      apply: false,
      resolverVersion: undefined,
    });
    expect(dryRun.planned).toBe(1);
    expect(dryRun.collisions).toEqual([]);
    expect(dryRun.applied).toBe(false);

    // Dry-run left the row untouched.
    const repo = new CanonicalSponsorFamilyRepo();
    const stillLower = await repo.getById("fam-lower");
    expect(stillLower?.normalized_name).toBe("acme sponsor");

    const applied = await migrateUppercase(SPONSOR_TARGET, {
      apply: true,
      resolverVersion: undefined,
    });
    expect(applied.applied).toBe(true);
    expect(applied.planned).toBe(1);
    expect(applied.collisions).toEqual([]);

    const folded = await repo.getById("fam-lower");
    expect(folded?.normalized_name).toBe("ACME SPONSOR");

    // findByResolverAndName now hits.
    const lookup = await repo.findByResolverAndName("1.0.0", "ACME SPONSOR");
    expect(lookup?.canonical_sponsor_family_id).toBe("fam-lower");
  });

  it("refuses to apply when a lowercase row collides with an existing UPPER row", async () => {
    await seed("fam-lower", "acme sponsor", "acme sponsor");
    await seed("fam-upper", "Acme Sponsor", "ACME SPONSOR");
    // Pre-create an alias on the offender so the collision row's `aliases`
    // count is non-zero — the diagnostic TSV must surface this.
    await new CanonicalSponsorFamilyAliasRepo().add(
      "fam-lower",
      "fam-upper",
      "pre-existing variant",
      "test"
    );

    // Aliasing rewrites resolution but the lowercase row physically remains
    // in the canonical table; migrate-uppercase must still detect the clash.
    const result = await migrateUppercase(SPONSOR_TARGET, {
      apply: true,
      resolverVersion: undefined,
    });
    expect(result.applied).toBe(false);
    expect(result.collisions.length).toBe(1);
    const c = result.collisions[0];
    expect(c.lower_id).toBe("fam-lower");
    expect(c.upper_id).toBe("fam-upper");
    expect(c.lower_name).toBe("acme sponsor");
    expect(c.upper_name).toBe("ACME SPONSOR");
    // The alias count picks up the pre-installed alias row.
    expect(c.aliases).toBeGreaterThan(0);

    // No write happened.
    const repo = new CanonicalSponsorFamilyRepo();
    const stillLower = await repo.getById("fam-lower");
    expect(stillLower?.normalized_name).toBe("acme sponsor");
  });

  it("leaves rows untouched on a dry-run and reports the planned count", async () => {
    await seed("fam-1", "acme sponsor", "acme sponsor");
    await seed("fam-2", "beta sponsor", "beta sponsor");

    const result = await migrateUppercase(SPONSOR_TARGET, {
      apply: false,
      resolverVersion: undefined,
    });
    expect(result.planned).toBe(2);
    expect(result.applied).toBe(false);

    const repo = new CanonicalSponsorFamilyRepo();
    expect((await repo.getById("fam-1"))?.normalized_name).toBe("acme sponsor");
    expect((await repo.getById("fam-2"))?.normalized_name).toBe("beta sponsor");
  });

  it("scopes to the supplied --resolver-version", async () => {
    await seed("fam-old", "acme sponsor", "acme sponsor", "1.0.0");
    await seed("fam-new", "beta sponsor", "beta sponsor", "2.0.0");

    const result = await migrateUppercase(SPONSOR_TARGET, {
      apply: true,
      resolverVersion: "1.0.0",
    });
    expect(result.planned).toBe(1);
    expect(result.applied).toBe(true);

    const repo = new CanonicalSponsorFamilyRepo();
    expect((await repo.getById("fam-old"))?.normalized_name).toBe("ACME SPONSOR");
    // Row on the other version was skipped.
    expect((await repo.getById("fam-new"))?.normalized_name).toBe("beta sponsor");
  });
});
