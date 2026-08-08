/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GoldenFixtureEntry } from "./goldenFixtureManifest";
import {
  applyGoldenFixtureTransform,
  GOLDEN_FIXTURES,
  goldenFixtureUrl,
} from "./goldenFixtureManifest";
import type { GoldenFixtureDeps } from "./goldenFixtures";
import {
  checkGoldenFixturesOnDisk,
  resolveGoldenFixtureRoot,
  runGoldenFixtures,
  sha256Hex,
} from "./goldenFixtures";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const BODY = "<HTML><BODY>prospectus</BODY></HTML>";
const WRAPPED =
  "<DOCUMENT>\n<TYPE>424B4\n<SEQUENCE>1\n<FILENAME>doc.htm\n<DESCRIPTION>PROSPECTUS\n<TEXT>\n" +
  BODY +
  "\n</TEXT>\n</DOCUMENT>\n";

const verbatimEntry: GoldenFixtureEntry = {
  file: "s1_1_000000000000000001.htm",
  dir: "s1",
  cik: "1",
  accession: "000000000000000001",
  primaryDoc: "doc.htm",
  transform: "verbatim",
  remoteSha256: sha256Hex(enc(BODY)),
  sha256: sha256Hex(enc(BODY)),
  bytes: enc(BODY).length,
};

const wrappedEntry: GoldenFixtureEntry = {
  file: "424b4_2_000000000000000002.htm",
  dir: "424",
  cik: "2",
  accession: "000000000000000002",
  primaryDoc: "doc.htm",
  transform: "strip-sgml-wrapper",
  remoteSha256: sha256Hex(enc(WRAPPED)),
  sha256: sha256Hex(enc(BODY)),
  bytes: enc(BODY).length,
};

function depsServing(map: Record<string, Uint8Array | Error>): GoldenFixtureDeps {
  return {
    log: () => {},
    fetchDoc: async (url: string) => {
      const hit = map[url];
      if (hit === undefined) throw new Error(`unexpected url ${url}`);
      if (hit instanceof Error) throw hit;
      return hit;
    },
  };
}

describe("applyGoldenFixtureTransform", () => {
  it("passes verbatim bytes through untouched", () => {
    const raw = enc(BODY);
    expect(applyGoldenFixtureTransform(raw, "verbatim")).toBe(raw);
  });

  it("slices the body out of a dissemination SGML wrapper", () => {
    const out = applyGoldenFixtureTransform(enc(WRAPPED), "strip-sgml-wrapper");
    expect(new TextDecoder().decode(out)).toBe(BODY);
  });

  it("tolerates a header without a <DESCRIPTION> line", () => {
    const noDesc = "<DOCUMENT>\n<TYPE>S-1\n<TEXT>\n" + BODY + "\n</TEXT>\n</DOCUMENT>\n";
    expect(
      new TextDecoder().decode(applyGoldenFixtureTransform(enc(noDesc), "strip-sgml-wrapper"))
    ).toBe(BODY);
  });

  it("throws when the wrapper is absent rather than returning a mangled body", () => {
    expect(() => applyGoldenFixtureTransform(enc(BODY), "strip-sgml-wrapper")).toThrow(
      /dissemination SGML wrapper/
    );
  });
});

describe("goldenFixtureUrl", () => {
  it("builds the EDGAR archive path", () => {
    expect(goldenFixtureUrl(verbatimEntry)).toBe(
      "https://www.sec.gov/Archives/edgar/data/1/000000000000000001/doc.htm"
    );
  });
});

describe("runGoldenFixtures", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "golden-fixtures-"));
    mkdirSync(join(root, "s1"), { recursive: true });
    mkdirSync(join(root, "424"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const entries = [verbatimEntry, wrappedEntry];
  const goodDeps = () =>
    depsServing({
      [goldenFixtureUrl(verbatimEntry)]: enc(BODY),
      [goldenFixtureUrl(wrappedEntry)]: enc(WRAPPED),
    });

  it("downloads both transforms and writes the post-transform body", async () => {
    const result = await runGoldenFixtures({
      mode: "download",
      deps: goodDeps(),
      rootDir: root,
      entries,
    });

    expect(result.written).toBe(2);
    expect(result.failed).toBe(0);
    expect(readFileSync(join(root, "s1", verbatimEntry.file), "utf-8")).toBe(BODY);
    // The wrapper must not survive into the fixture — that is the whole point
    // of recording a transform rather than a raw URL.
    expect(readFileSync(join(root, "424", wrappedEntry.file), "utf-8")).toBe(BODY);
  });

  it("skips fixtures that already match, and re-downloads them under --force", async () => {
    await runGoldenFixtures({ mode: "download", deps: goodDeps(), rootDir: root, entries });

    const second = await runGoldenFixtures({
      mode: "download",
      deps: goodDeps(),
      rootDir: root,
      entries,
    });
    expect(second.ok).toBe(2);
    expect(second.written).toBe(0);

    const forced = await runGoldenFixtures({
      mode: "download",
      deps: goodDeps(),
      rootDir: root,
      entries,
      force: true,
    });
    expect(forced.written).toBe(2);
  });

  it("refuses to write a document whose remote digest moved", async () => {
    const deps = depsServing({
      [goldenFixtureUrl(verbatimEntry)]: enc("<HTML>an EDGAR error page</HTML>"),
      [goldenFixtureUrl(wrappedEntry)]: enc(WRAPPED),
    });
    const result = await runGoldenFixtures({ mode: "download", deps, rootDir: root, entries });

    expect(result.outcomes[0].status).toBe("remote-changed");
    expect(result.failed).toBe(1);
    // Nothing written for the bad entry: a corrupt fixture on disk is the
    // failure mode that would otherwise masquerade as a parser regression.
    expect(() => readFileSync(join(root, "s1", verbatimEntry.file))).toThrow();
  });

  it("reports a fetch failure as an error without aborting the remaining entries", async () => {
    const deps = depsServing({
      [goldenFixtureUrl(verbatimEntry)]: new Error("403 Forbidden"),
      [goldenFixtureUrl(wrappedEntry)]: enc(WRAPPED),
    });
    const result = await runGoldenFixtures({ mode: "download", deps, rootDir: root, entries });

    expect(result.outcomes[0]).toMatchObject({ status: "error", detail: "403 Forbidden" });
    expect(result.outcomes[1].status).toBe("written");
  });

  it("verify passes when disk matches EDGAR, and writes nothing", async () => {
    await runGoldenFixtures({ mode: "download", deps: goodDeps(), rootDir: root, entries });
    writeFileSync(join(root, "s1", "stray.htm"), "untouched");

    const result = await runGoldenFixtures({
      mode: "verify",
      deps: goodDeps(),
      rootDir: root,
      entries,
    });

    expect(result.ok).toBe(2);
    expect(result.written).toBe(0);
    expect(readFileSync(join(root, "s1", "stray.htm"), "utf-8")).toBe("untouched");
  });

  it("verify distinguishes a locally edited fixture from a changed remote", async () => {
    await runGoldenFixtures({ mode: "download", deps: goodDeps(), rootDir: root, entries });
    writeFileSync(join(root, "s1", verbatimEntry.file), BODY + "<!-- hand edit -->");

    const edited = await runGoldenFixtures({
      mode: "verify",
      deps: goodDeps(),
      rootDir: root,
      entries,
    });
    expect(edited.outcomes[0].status).toBe("local-modified");

    const moved = await runGoldenFixtures({
      mode: "verify",
      rootDir: root,
      entries: [wrappedEntry],
      deps: depsServing({
        [goldenFixtureUrl(wrappedEntry)]: enc("<DOCUMENT>\n<TEXT>\nnew\n</TEXT>\n"),
      }),
    });
    expect(moved.outcomes[0].status).toBe("remote-changed");
  });

  it("verify reports a fixture that is absent from disk", async () => {
    const result = await runGoldenFixtures({
      mode: "verify",
      deps: goodDeps(),
      rootDir: root,
      entries,
    });
    expect(result.outcomes.map((o) => o.status)).toEqual(["missing", "missing"]);
    expect(result.failed).toBe(2);
  });

  it("flags a manifest whose transform contradicts its own digests", async () => {
    // remoteSha256 matches what is served, but sha256 does not match the
    // transform's output — i.e. the pin itself is internally inconsistent.
    const badPin: GoldenFixtureEntry = {
      ...wrappedEntry,
      sha256: sha256Hex(enc("something else")),
    };
    const result = await runGoldenFixtures({
      mode: "download",
      rootDir: root,
      entries: [badPin],
      deps: depsServing({ [goldenFixtureUrl(badPin)]: enc(WRAPPED) }),
    });

    expect(result.outcomes[0].status).toBe("error");
    expect(result.outcomes[0].detail).toMatch(/manifest transform is wrong/);
  });
});

describe("committed golden fixture corpus", () => {
  // Hermetic: no network. This is the guard that actually fires in CI — it
  // catches a golden fixture edited in place, which would otherwise silently
  // re-baseline every parser/segmenter test that reads it.
  it("matches the pinned manifest digests on disk", () => {
    const problems = checkGoldenFixturesOnDisk().filter((o) => o.status !== "ok");
    expect(problems).toEqual([]);
  });

  it("pins every real capture exactly once", () => {
    const files = GOLDEN_FIXTURES.map((e) => e.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it("keeps digests distinct per entry", () => {
    const shas = GOLDEN_FIXTURES.map((e) => e.sha256);
    expect(new Set(shas).size).toBe(shas.length);
  });

  // The checks above all read manifest → disk, so an EDGAR capture that is on
  // disk but absent from the manifest passes every one of them while being
  // completely unguarded: no pinned digest means nothing detects it drifting or
  // being hand-edited, even though the eval harness scores against it. That is
  // not hypothetical — `s1_1507957` (Ideal Power) sat unpinned while carrying
  // golden labels for two extractors. This is the disk → manifest direction.
  it("pins every real capture that is on disk", () => {
    const root = resolveGoldenFixtureRoot();
    const pinned = new Set(GOLDEN_FIXTURES.map((e) => `${e.dir}/${e.file}`));
    const unpinned: string[] = [];

    for (const dir of new Set(GOLDEN_FIXTURES.map((e) => e.dir))) {
      // Only `.htm` captures: the synthetic `.txt` full-submission fixtures are
      // hand-authored SGML that exists nowhere on EDGAR, so they are
      // deliberately unpinnable (see the GOLDEN_FIXTURES doc comment).
      for (const file of readdirSync(join(root, dir))) {
        if (!file.endsWith(".htm")) continue;
        if (!pinned.has(`${dir}/${file}`)) unpinned.push(`${dir}/${file}`);
      }
    }

    expect(unpinned).toEqual([]);
  });
});
