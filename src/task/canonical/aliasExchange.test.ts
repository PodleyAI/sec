/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { normalizeUnderwriterFamilyName } from "../../resolver/UnderwriterFamilyResolver";
import { CanonicalCompanyRepo } from "../../storage/canonical/CanonicalCompanyRepo";
import { CanonicalCompanyAliasRepo } from "../../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalPersonRepo } from "../../storage/canonical/CanonicalPersonRepo";
import { CanonicalPersonAliasRepo } from "../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalUnderwriterFamilyRepo } from "../../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { CanonicalUnderwriterFamilyAliasRepo } from "../../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { CanonicalAliasAddTask } from "./CanonicalAliasAddTask";
import { CanonicalAliasListTask } from "./CanonicalAliasListTask";
import { FamilyAliasAddTask } from "./FamilyAliasAddTask";
import { FamilyAliasListTask } from "./FamilyAliasListTask";
import { formatAliasTsv, parseAliasTsv } from "./aliasTsv";

/**
 * The re-key ceremony (`scripts/sql/truncate-identity-tier*.sql`) deletes every
 * alias table, because alias rows are keyed by canonical UUIDs the wipe itself
 * destroys. They are hand-curated claims no pipeline can rebuild, so the only
 * thing that makes the ceremony survivable is an export keyed by NAME and an
 * import that reads it back.
 *
 * These tests are the round trip end to end: curate, export, wipe, re-import,
 * assert the set is restored.
 */

/** A canonical company, as the resolver would have minted it. */
async function makeCompany(id: string, displayName: string): Promise<void> {
  await new CanonicalCompanyRepo().create({
    canonical_company_id: id,
    resolver_version: "1.0.0",
    display_name: displayName,
    normalized_name: displayName,
    cik: null,
    crd: null,
    created_at: new Date().toISOString(),
  });
}

/** A canonical person, as the resolver would have minted it. */
async function makePerson(id: string, first: string, last: string): Promise<void> {
  await new CanonicalPersonRepo().create({
    canonical_person_id: id,
    resolver_version: "1.0.0",
    display_first: first,
    display_middle: null,
    display_last: last,
    display_suffix: null,
    cik: null,
    normalized_first: first.toLowerCase(),
    normalized_middle: null,
    normalized_last: last.toLowerCase(),
    normalized_suffix: null,
    source_filing_issuer_cik: null,
    created_at: new Date().toISOString(),
  });
}

async function makeFamily(id: string, displayName: string): Promise<void> {
  await new CanonicalUnderwriterFamilyRepo().create({
    canonical_underwriter_family_id: id,
    resolver_version: "1.0.0",
    display_name: displayName,
    normalized_name: normalizeUnderwriterFamilyName(displayName),
    created_at: new Date().toISOString(),
  });
}

describe("alias export/import round trip", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("restores person aliases from a name-keyed export after the ids are gone", async () => {
    // The person canonical tier is wiped outright by the re-key ceremony, so
    // every id an alias row cites is destroyed. Only the name survives.
    const OLD_A = "11111111-1111-4111-8111-111111111111";
    const OLD_B = "22222222-2222-4222-8222-222222222222";
    await makePerson(OLD_A, "Frank", "Martire, Jr.");
    await makePerson(OLD_B, "Frank", "Martire");
    const added = await new CanonicalAliasAddTask({
      defaults: { kind: "person", from: OLD_A, into: OLD_B, reason: "same person" },
    }).run();
    expect(added.error).toBeNull();

    const before = await new CanonicalAliasListTask({ defaults: { kind: "person" } }).run();
    expect(before.aliases).toHaveLength(1);
    // The export is only useful if it carries the NAMES.
    expect(before.aliases[0]!.alias_name).toBe("Frank Martire, Jr.");
    expect(before.aliases[0]!.target_name).toBe("Frank Martire");

    const exported = formatAliasTsv(before.aliases);
    // A comma-separated export would be unreadable for exactly these names —
    // the repo's only CSV reader splits on commas with no quoting.
    expect(exported.split("\n")[1]!.split("\t")[0]).toBe("Frank Martire, Jr.");

    // The wipe: the alias rows go, and so does every canonical row they cited.
    await new CanonicalPersonAliasRepo().remove(OLD_A);
    await new CanonicalPersonRepo().deleteById(OLD_A);
    await new CanonicalPersonRepo().deleteById(OLD_B);
    expect(
      (await new CanonicalAliasListTask({ defaults: { kind: "person" } }).run()).aliases
    ).toHaveLength(0);

    // Re-extraction re-mints the canonicals under NEW ids; only the names carry
    // over. An export keyed by id would restore nothing here.
    const NEW_A = "99999999-9999-4999-8999-999999999999";
    const NEW_B = "88888888-8888-4888-8888-888888888888";
    await makePerson(NEW_A, "Frank", "Martire, Jr.");
    await makePerson(NEW_B, "Frank", "Martire");

    const { rows, errors } = parseAliasTsv(exported);
    expect(errors).toEqual([]);
    for (const row of rows) {
      const out = await new CanonicalAliasAddTask({
        defaults: { kind: "person", from: row.from, into: row.into, reason: row.reason },
      }).run();
      expect(out.error).toBeNull();
    }

    const after = await new CanonicalAliasListTask({ defaults: { kind: "person" } }).run();
    expect(after.aliases).toHaveLength(1);
    expect(after.aliases[0]!.alias_name).toBe("Frank Martire, Jr.");
    expect(after.aliases[0]!.target_name).toBe("Frank Martire");
    expect(after.aliases[0]!.reason).toBe("same person");
    // Restored against the NEW canonical ids, which is the whole point.
    expect(after.aliases[0]!.alias_canonical_id).toBe(NEW_A);
    expect(after.aliases[0]!.target_canonical_id).toBe(NEW_B);
  });

  it("restores underwriter-family aliases the same way", async () => {
    await makeFamily("fam-1", "Chardan Capital Markets");
    await makeFamily("fam-2", "Chardan");
    await new FamilyAliasAddTask({
      defaults: {
        family: "underwriter",
        fromName: "Chardan Capital Markets",
        intoName: "Chardan",
        reason: "subsidiary",
        resolverVersion: "1.0.0",
      },
    }).run();

    const before = await new FamilyAliasListTask({ defaults: { family: "underwriter" } }).run();
    expect(before.aliases).toHaveLength(1);
    expect(before.aliases[0]!.alias_name).toBe("Chardan Capital Markets");
    expect(before.aliases[0]!.target_name).toBe("Chardan");
    const exported = formatAliasTsv(before.aliases);

    await new CanonicalUnderwriterFamilyAliasRepo().remove("fam-1");
    expect(
      (await new FamilyAliasListTask({ defaults: { family: "underwriter" } }).run()).aliases
    ).toHaveLength(0);

    const { rows, errors } = parseAliasTsv(exported);
    expect(errors).toEqual([]);
    for (const row of rows) {
      const out = await new FamilyAliasAddTask({
        defaults: {
          family: "underwriter",
          fromName: row.from,
          intoName: row.into,
          reason: row.reason,
          resolverVersion: "1.0.0",
        },
      }).run();
      expect(out.error).toBeNull();
    }

    const after = await new FamilyAliasListTask({ defaults: { family: "underwriter" } }).run();
    expect(after.aliases).toHaveLength(1);
    expect(after.aliases[0]!.alias_name).toBe("Chardan Capital Markets");
    expect(after.aliases[0]!.target_name).toBe("Chardan");
    expect(after.aliases[0]!.reason).toBe("subsidiary");
  });

  it("reports an orphaned side as null rather than inventing a name", async () => {
    // A dangling alias is exactly what `--orphans` is for; the listing must show
    // it as unresolved so an operator can see what cannot be restored.
    await makeCompany("11111111-1111-4111-8111-111111111111", "Acme Capital LLC");
    await new CanonicalCompanyAliasRepo().add("11111111-1111-4111-8111-111111111111", "00000000-0000-4000-8000-000000000000", "stale", "test");
    const { aliases } = await new CanonicalAliasListTask({ defaults: { kind: "company" } }).run();
    expect(aliases[0]!.alias_name).toBe("Acme Capital LLC");
    expect(aliases[0]!.target_name).toBeNull();
    expect(formatAliasTsv(aliases)).toContain("Acme Capital LLC\t\tstale");
  });
});

describe("parseAliasTsv", () => {
  it("locates columns by header name, not position", () => {
    const { rows, errors } = parseAliasTsv(
      "target_name\treason\talias_name\nInto Co\twhy\tFrom Co\n"
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ from: "From Co", into: "Into Co", reason: "why" }]);
  });

  it("reports a row whose names are missing instead of importing a half pair", () => {
    // The ids are no help: the wipe that made the export necessary destroyed
    // them, so a row with no names names nothing.
    const { rows, errors } = parseAliasTsv(
      "alias_name\ttarget_name\treason\talias_id\ttarget_id\n\t\t\tco-1\tco-2\n"
    );
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("missing alias_name or target_name");
  });

  it("rejects a file whose header names neither column", () => {
    const { rows, errors } = parseAliasTsv("a\tb\nx\ty\n");
    expect(rows).toEqual([]);
    expect(errors[0]).toContain("alias_name");
  });
});
