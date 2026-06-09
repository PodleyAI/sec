/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Command } from "commander";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { setupAllDatabases } from "../config/setupAllDatabases";
import { SecCliConfigurationError } from "../config/EnvToDI";
import { CanonicalSponsorFamilyRepo } from "../storage/canonical/CanonicalSponsorFamilyRepo";
import {
  _internal,
  checkStaleCanonicalFamilies,
  runStaleCanonicalGuard,
} from "./StaleCanonicalGuard";

interface BuildOptions {
  readonly path: ReadonlyArray<string>;
}

/**
 * Build a synthetic Commander action command sitting at the given subcommand
 * path. The guard only reads `.name()` and `.parent` so this is the smallest
 * shape that exercises the categorisation logic.
 */
function buildAction(opts: BuildOptions): Command {
  const root = new Command();
  let cursor: Command = root;
  for (const name of opts.path) {
    const child = new Command(name);
    cursor.addCommand(child);
    cursor = child;
  }
  return cursor;
}

async function seedLowercaseRow(): Promise<void> {
  await new CanonicalSponsorFamilyRepo().create({
    canonical_sponsor_family_id: "fam-lower",
    resolver_version: "1.0.0",
    display_name: "acme sponsor",
    normalized_name: "acme sponsor",
    created_at: new Date().toISOString(),
  });
}

describe("StaleCanonicalGuard", () => {
  let originalWarn: typeof console.warn;
  let warnSpy: ReturnType<typeof mock>;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    originalWarn = console.warn;
    warnSpy = mock(() => {});
    console.warn = warnSpy as unknown as typeof console.warn;
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  describe("checkStaleCanonicalFamilies", () => {
    it("returns zero when no rows exist", async () => {
      const counts = await checkStaleCanonicalFamilies();
      expect(counts.sponsor).toBe(0);
      expect(counts.underwriter).toBe(0);
    });

    it("counts lowercase rows", async () => {
      await seedLowercaseRow();
      const counts = await checkStaleCanonicalFamilies();
      expect(counts.sponsor).toBe(1);
      expect(counts.underwriter).toBe(0);
    });
  });

  describe("runStaleCanonicalGuard", () => {
    it("warns (no throw) on a non-safety-critical command when stale rows exist", async () => {
      await seedLowercaseRow();
      const actionCommand = buildAction({ path: ["fetch", "form"] });

      await runStaleCanonicalGuard({
        actionCommand,
        allowStale: false,
        useColor: false,
      });

      expect(warnSpy).toHaveBeenCalled();
      const lastArg = String(warnSpy.mock.calls[0]?.[0] ?? "");
      expect(lastArg).toContain("stale lowercase rows");
      expect(lastArg).toContain("migrate-uppercase");
    });

    it("throws SecCliConfigurationError on `resolve` when stale rows exist", async () => {
      await seedLowercaseRow();
      const actionCommand = buildAction({ path: ["resolve"] });

      let caught: unknown = undefined;
      try {
        await runStaleCanonicalGuard({
          actionCommand,
          allowStale: false,
          useColor: false,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SecCliConfigurationError);
      expect((caught as Error).message).toContain("stale lowercase rows");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("throws on `canonical sponsor-family alias`", async () => {
      await seedLowercaseRow();
      const actionCommand = buildAction({
        path: ["canonical", "sponsor-family", "alias"],
      });

      let caught: unknown = undefined;
      try {
        await runStaleCanonicalGuard({
          actionCommand,
          allowStale: false,
          useColor: false,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SecCliConfigurationError);
    });

    it("throws on `underwriter by-family`", async () => {
      await seedLowercaseRow();
      const actionCommand = buildAction({ path: ["underwriter", "by-family"] });

      let caught: unknown = undefined;
      try {
        await runStaleCanonicalGuard({
          actionCommand,
          allowStale: false,
          useColor: false,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SecCliConfigurationError);
    });

    it("does not warn or throw when --allow-stale is passed", async () => {
      await seedLowercaseRow();
      const actionCommand = buildAction({ path: ["resolve"] });

      await runStaleCanonicalGuard({
        actionCommand,
        allowStale: true,
        useColor: false,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("is exempt for `init`", async () => {
      await seedLowercaseRow();
      const actionCommand = buildAction({ path: ["init"] });

      await runStaleCanonicalGuard({
        actionCommand,
        allowStale: false,
        useColor: false,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("is exempt for `db status`", async () => {
      await seedLowercaseRow();
      const actionCommand = buildAction({ path: ["db", "status"] });

      await runStaleCanonicalGuard({
        actionCommand,
        allowStale: false,
        useColor: false,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("is exempt for the `migrate-uppercase` command itself", async () => {
      await seedLowercaseRow();
      const actionCommand = buildAction({
        path: ["canonical", "sponsor-family", "migrate-uppercase"],
      });

      await runStaleCanonicalGuard({
        actionCommand,
        allowStale: false,
        useColor: false,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does nothing when there are no stale rows", async () => {
      const actionCommand = buildAction({ path: ["fetch", "form"] });

      await runStaleCanonicalGuard({
        actionCommand,
        allowStale: false,
        useColor: false,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("path categorisation helpers", () => {
    it("classifies `spac by-family` as safety-critical", () => {
      const action = buildAction({ path: ["spac", "by-family"] });
      expect(_internal.isSafetyCritical(_internal.commandPath(action))).toBe(true);
    });

    it("classifies `canonical company alias` as safety-critical", () => {
      const action = buildAction({ path: ["canonical", "company", "alias"] });
      expect(_internal.isSafetyCritical(_internal.commandPath(action))).toBe(true);
    });

    it("classifies arbitrary `fetch form` as neither exempt nor safety-critical", () => {
      const action = buildAction({ path: ["fetch", "form"] });
      const path = _internal.commandPath(action);
      expect(_internal.isExemptCommand(path)).toBe(false);
      expect(_internal.isSafetyCritical(path)).toBe(false);
    });
  });
});
