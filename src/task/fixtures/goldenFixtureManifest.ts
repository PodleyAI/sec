/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provenance for the **committed** golden fixtures under
 * `src/sec/html/mock_data/{s1,424}/` — the corpus that pins the SGML-header
 * parser, HTML converter, section segmenter, and iXBRL parser.
 *
 * These files stay committed (the golden tests are hermetic and must not depend
 * on EDGAR being reachable), so this manifest is the machine-readable half of
 * each directory's `SOURCES.md`: it says exactly which EDGAR document every
 * fixture came from and pins both the remote bytes and the on-disk bytes by
 * digest. That buys three things the prose table could not:
 *
 * - `sec fetch golden-fixtures --verify` proves the committed files are still
 *   unmodified captures of the live EDGAR documents;
 * - `sec fetch golden-fixtures` reproduces the corpus from scratch;
 * - a hermetic unit test hashes the committed files against `sha256`, so an
 *   accidental edit fails loudly instead of silently re-baselining a golden test.
 *
 * EDGAR `Archives/` documents are immutable once filed, so a `remoteSha256`
 * mismatch means the capture convention changed (or the wrong document is
 * pinned) — not that the filing was revised.
 */

/** Fixture sub-directory under `src/sec/html/mock_data/`. */
export const GOLDEN_FIXTURE_DIRS = ["s1", "424"] as const;
export type GoldenFixtureDir = (typeof GOLDEN_FIXTURE_DIRS)[number];

/**
 * How the committed file is derived from the bytes EDGAR serves.
 *
 * - `verbatim` — the document is stored exactly as served.
 * - `strip-sgml-wrapper` — EDGAR serves this document still wrapped in its
 *   dissemination SGML (`<DOCUMENT><TYPE>…<TEXT>` … `</TEXT></DOCUMENT>`).
 *   The committed fixture is the inner body only, which is what
 *   `Form_S_1.parse()` / `Form_424.parse()` hand the converter in production —
 *   so the fixture exercises the same input the pipeline actually sees.
 */
export const GOLDEN_FIXTURE_TRANSFORMS = ["verbatim", "strip-sgml-wrapper"] as const;
export type GoldenFixtureTransform = (typeof GOLDEN_FIXTURE_TRANSFORMS)[number];

export interface GoldenFixtureEntry {
  /** Committed filename, e.g. `s1_1848507_000119312521066104.htm`. */
  readonly file: string;
  readonly dir: GoldenFixtureDir;
  /** Unpadded CIK, as it appears in the EDGAR archive path. */
  readonly cik: string;
  /** Accession number without dashes, as it appears in the archive path. */
  readonly accession: string;
  /** Primary-document filename served by EDGAR for this accession. */
  readonly primaryDoc: string;
  readonly transform: GoldenFixtureTransform;
  /** SHA-256 of the bytes EDGAR serves, before {@link transform}. */
  readonly remoteSha256: string;
  /** SHA-256 of the committed file, after {@link transform}. */
  readonly sha256: string;
  /** Byte length of the committed file. */
  readonly bytes: number;
}

/**
 * Every real EDGAR capture in the golden corpus.
 *
 * The synthetic full-submission `.txt` fixtures (`drs_*.txt`, `f1_*.txt`) are
 * deliberately absent: they are hand-authored SGML that exists nowhere on
 * EDGAR, so they can be neither downloaded nor verified.
 */
export const GOLDEN_FIXTURES: readonly GoldenFixtureEntry[] = [
  {
    file: "s1_1817004_000149315226027137.htm",
    dir: "s1",
    cik: "1817004",
    accession: "000149315226027137",
    primaryDoc: "forms-1.htm",
    transform: "verbatim",
    remoteSha256: "ac57b5568dcb12ee08fe179e5d020384b0a619fd8ac6a083be5dd276392fc6d6",
    sha256: "ac57b5568dcb12ee08fe179e5d020384b0a619fd8ac6a083be5dd276392fc6d6",
    bytes: 461287,
  },
  {
    file: "s1_1822912_000121390021001475.htm",
    dir: "s1",
    cik: "1822912",
    accession: "000121390021001475",
    primaryDoc: "fs12021a1_26capitalacq.htm",
    transform: "verbatim",
    remoteSha256: "9f1e7b7599fcd6d5c0d7a4b807d71deecb7fb7de84f27bf554f8dc93e77bd7fc",
    sha256: "9f1e7b7599fcd6d5c0d7a4b807d71deecb7fb7de84f27bf554f8dc93e77bd7fc",
    bytes: 2729727,
  },
  {
    file: "s1_1848507_000119312521066104.htm",
    dir: "s1",
    cik: "1848507",
    accession: "000119312521066104",
    primaryDoc: "d141894ds1.htm",
    transform: "verbatim",
    remoteSha256: "4e9f2522c9f72146c13fab813a823d74ab8b1748115046b99d1923c8c7aa12f2",
    sha256: "4e9f2522c9f72146c13fab813a823d74ab8b1748115046b99d1923c8c7aa12f2",
    bytes: 1565952,
  },
  {
    file: "s1_1849470_000110465921035696.htm",
    dir: "s1",
    cik: "1849470",
    accession: "000110465921035696",
    primaryDoc: "tm2192661d1_s1.htm",
    transform: "verbatim",
    remoteSha256: "8b3857a24aa5adbf632253a845f658fe99760bc6930a1271db8a1a990e3722d0",
    sha256: "8b3857a24aa5adbf632253a845f658fe99760bc6930a1271db8a1a990e3722d0",
    bytes: 1381442,
  },
  {
    file: "s1_2030954_000149315226027129.htm",
    dir: "s1",
    cik: "2030954",
    accession: "000149315226027129",
    primaryDoc: "forms-1a.htm",
    transform: "verbatim",
    remoteSha256: "d85b95a865afe1bea8a6b527bade80f58f651baf5810d35d05af72159104a2cd",
    sha256: "d85b95a865afe1bea8a6b527bade80f58f651baf5810d35d05af72159104a2cd",
    bytes: 495938,
  },
  {
    file: "s1_2087989_000143774926019444.htm",
    dir: "s1",
    cik: "2087989",
    accession: "000143774926019444",
    primaryDoc: "tpmt20260603_s1a.htm",
    transform: "verbatim",
    remoteSha256: "16c91b83787f4b9a75dbed67cb09d8075db42756c0faa02647e8369bb16faa6b",
    sha256: "16c91b83787f4b9a75dbed67cb09d8075db42756c0faa02647e8369bb16faa6b",
    bytes: 703110,
  },
  {
    file: "s1_2114227_000121390026039320.htm",
    dir: "s1",
    cik: "2114227",
    accession: "000121390026039320",
    primaryDoc: "ea0283481-01.htm",
    transform: "verbatim",
    remoteSha256: "8baa45a08a034bf13eb9ac5279f9ed41c29cdd78a8e1afb1c563c6829dd1e2e6",
    sha256: "8baa45a08a034bf13eb9ac5279f9ed41c29cdd78a8e1afb1c563c6829dd1e2e6",
    bytes: 4041400,
  },
  {
    file: "424b4_2114227_000121390026048413.htm",
    dir: "424",
    cik: "2114227",
    accession: "000121390026048413",
    primaryDoc: "ea0283481-05.htm",
    transform: "strip-sgml-wrapper",
    remoteSha256: "b8a5e9ee75a85a393a675c3f67bebc1791265e02f664dd804a1ae616d7d55404",
    sha256: "c664dcf6a85d4a15da79f6f37b9fe5b94f161525c4fe460b761bbeb09dbdcaff",
    bytes: 3738728,
  },
] as const;

/** EDGAR archive URL for a fixture's primary document. */
export function goldenFixtureUrl(entry: GoldenFixtureEntry): string {
  return `https://www.sec.gov/Archives/edgar/data/${entry.cik}/${entry.accession}/${entry.primaryDoc}`;
}

const TEXT_OPEN = "<TEXT>\n";
const TEXT_CLOSE = "\n</TEXT>";

/**
 * Derive the committed fixture bytes from what EDGAR served.
 *
 * The `strip-sgml-wrapper` case slices between the `<TEXT>` markers rather than
 * dropping a fixed number of header lines, because the dissemination header's
 * fields are optional (`<DESCRIPTION>` in particular is often absent).
 */
export function applyGoldenFixtureTransform(
  raw: Uint8Array,
  transform: GoldenFixtureTransform
): Uint8Array {
  if (transform === "verbatim") return raw;

  const text = new TextDecoder().decode(raw);
  const open = text.indexOf(TEXT_OPEN);
  const close = text.lastIndexOf(TEXT_CLOSE);
  if (open < 0 || close < 0 || close <= open) {
    throw new Error(
      "Expected a dissemination SGML wrapper (<TEXT> … </TEXT>) but found none; " +
        "the document may now be served as bare HTML — re-pin this fixture as `verbatim`."
    );
  }
  return new TextEncoder().encode(text.slice(open + TEXT_OPEN.length, close));
}
