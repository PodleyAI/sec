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
    // Southern Cross Acquisition I Corp. — sibling of the II filing already in the corpus, from the same self-filer.
    file: "s1_2116230_000192998026000257.htm",
    dir: "s1",
    cik: "2116230",
    accession: "000192998026000257",
    primaryDoc: "sxgc_s1.htm",
    transform: "verbatim",
    remoteSha256: "602305fcca92ccffff72a066cf7a8959a3a5ebec60ed69463143f952a1f2cd70",
    sha256: "602305fcca92ccffff72a066cf7a8959a3a5ebec60ed69463143f952a1f2cd70",
    bytes: 2441989,
  },
  {
    // Bluerock Acquisition Corp. II — the only SPAC in the corpus with a focused
    // "The Sponsor" section, which is what finally gives `spac-sponsors` a SPAC
    // to be scored on (its only other section belongs to a commodity trust).
    file: "s1_2098410_000110465926086682.htm",
    dir: "s1",
    cik: "2098410",
    accession: "000110465926086682",
    primaryDoc: "tmb-20260724xs1.htm",
    transform: "verbatim",
    remoteSha256: "44807e815cd685431e24a4903afb7e0cf6022446c3d996875b78f805853bfc43",
    sha256: "44807e815cd685431e24a4903afb7e0cf6022446c3d996875b78f805853bfc43",
    bytes: 3229781,
  },
  {
    // AMR Resources Acquisition Corp. — replaces Ares Acquisition Corp III,
    // which tripped the stitched-table guard (a duplicated header row survived
    // into a table body). That is a real parser defect; the fixture was swapped
    // rather than the guard relaxed, so the guard still protects every filing.
    file: "s1_2110119_000121390026072712.htm",
    dir: "s1",
    cik: "2110119",
    accession: "000121390026072712",
    primaryDoc: "ea0274132-02.htm",
    transform: "verbatim",
    remoteSha256: "d11ccecbb85fef65d6be420fd92fa200cb4a026621571fedddfde9a853a94169",
    sha256: "d11ccecbb85fef65d6be420fd92fa200cb4a026621571fedddfde9a853a94169",
    bytes: 4578403,
  },
  // ── Corpus doubling: 10 more SPACs and 11 more operating companies. ───────
  {
    // Osprey Acquisition Corp. III
    file: "s1_2113481_000121390026068811.htm",
    dir: "s1",
    cik: "2113481",
    accession: "000121390026068811",
    primaryDoc: "ea0279881-02.htm",
    transform: "verbatim",
    remoteSha256: "d4789aab7e05cd0894b86fb643694a1b228d6d41839208112008be782d1b2cc1",
    sha256: "d4789aab7e05cd0894b86fb643694a1b228d6d41839208112008be782d1b2cc1",
    bytes: 4673605,
  },
  {
    // Churchill Capital Corp XIII — sibling of XII, so the corpus holds two filings from one sponsor family
    file: "s1_2114229_000121390026078277.htm",
    dir: "s1",
    cik: "2114229",
    accession: "000121390026078277",
    primaryDoc: "ea0297779-01.htm",
    transform: "verbatim",
    remoteSha256: "509a6c8582cfaa1906bf750ca5a7163b40addfa2a32909a79e57a18277bac559",
    sha256: "509a6c8582cfaa1906bf750ca5a7163b40addfa2a32909a79e57a18277bac559",
    bytes: 3826111,
  },
  {
    // Pinnacle Acquisition Corp
    file: "s1_2123955_000121390026080433.htm",
    dir: "s1",
    cik: "2123955",
    accession: "000121390026080433",
    primaryDoc: "ea0295579-02.htm",
    transform: "verbatim",
    remoteSha256: "ca20634c45a339890918c7e3a97445365d277a369ca7792d60356b1d8b207cb4",
    sha256: "ca20634c45a339890918c7e3a97445365d277a369ca7792d60356b1d8b207cb4",
    bytes: 3602555,
  },
  {
    // Bleichroeder Acquisition Corp. III
    file: "s1_2128045_000121390026070217.htm",
    dir: "s1",
    cik: "2128045",
    accession: "000121390026070217",
    primaryDoc: "ea0290849-02.htm",
    transform: "verbatim",
    remoteSha256: "e89cf3a397a0a42c93a81c6a96dfea621ae196a2b01bd0249d325215e3f76cde",
    sha256: "e89cf3a397a0a42c93a81c6a96dfea621ae196a2b01bd0249d325215e3f76cde",
    bytes: 4353793,
  },
  {
    // B&R Technology Merger Corp.
    file: "s1_2131350_000119312526294964.htm",
    dir: "s1",
    cik: "2131350",
    accession: "000119312526294964",
    primaryDoc: "d112816ds1.htm",
    transform: "verbatim",
    remoteSha256: "1f6970da2d7005978733701f47d1e21cc887ebdc55076b1bb15dad6c7993f518",
    sha256: "1f6970da2d7005978733701f47d1e21cc887ebdc55076b1bb15dad6c7993f518",
    bytes: 2734725,
  },
  {
    // OceanLight Acquisition Corp — the THIRD filing whose RISK_FACTORS collapses to a ~1k stub, and the third from agent 0001829126 (with Albatross and Karman). Three of twenty SPACs from one agent lose the section entirely
    file: "s1_2137679_000182912626006500.htm",
    dir: "s1",
    cik: "2137679",
    accession: "000182912626006500",
    primaryDoc: "oceanlightacq_s1.htm",
    transform: "verbatim",
    remoteSha256: "edd60dd19eba2acc09a730702126ea8d6a944511ea3a84e27793803093506e50",
    sha256: "edd60dd19eba2acc09a730702126ea8d6a944511ea3a84e27793803093506e50",
    bytes: 2021041,
  },
  {
    // TCGX Acquisition Corp.
    file: "s1_2137965_000119312526308950.htm",
    dir: "s1",
    cik: "2137965",
    accession: "000119312526308950",
    primaryDoc: "d85347ds1.htm",
    transform: "verbatim",
    remoteSha256: "b4f970482f8d8c7aad8e04a4d9b2c7e289d0480c7489a1f8e372639903e3c3e7",
    sha256: "b4f970482f8d8c7aad8e04a4d9b2c7e289d0480c7489a1f8e372639903e3c3e7",
    bytes: 1973421,
  },
  {
    // Flux Power Holdings, Inc. (SIC 3690)
    file: "s1_1083743_000149315226025047.htm",
    dir: "s1",
    cik: "1083743",
    accession: "000149315226025047",
    primaryDoc: "forms-1.htm",
    transform: "verbatim",
    remoteSha256: "4ad40a06d29f2ec7b181a3b6f790054cdf343c0c6ad75194871366c427fe7a5c",
    sha256: "4ad40a06d29f2ec7b181a3b6f790054cdf343c0c6ad75194871366c427fe7a5c",
    bytes: 3231111,
  },
  {
    // Mobia Medical, Inc. (SIC 3841)
    file: "s1_1489993_000162828026025811.htm",
    dir: "s1",
    cik: "1489993",
    accession: "000162828026025811",
    primaryDoc: "mobiamedical-sx1.htm",
    transform: "verbatim",
    remoteSha256: "346375790754ba61941c2b2ecc84785f131303ed43b9522bb4a53dc6e7f4ad82",
    sha256: "346375790754ba61941c2b2ecc84785f131303ed43b9522bb4a53dc6e7f4ad82",
    bytes: 2779965,
  },
  {
    // AUDDIA INC. (SIC 7374)
    file: "s1_1554818_000168316826002663.htm",
    dir: "s1",
    cik: "1554818",
    accession: "000168316826002663",
    primaryDoc: "auddia_s1.htm",
    transform: "verbatim",
    remoteSha256: "42ba98a8260c405d9be3509c102b031ea2c9bb16d49ccc8410de7cdfa0053de4",
    sha256: "42ba98a8260c405d9be3509c102b031ea2c9bb16d49ccc8410de7cdfa0053de4",
    bytes: 493663,
  },
  {
    // AZIO AI HOLDINGS, INC. (SIC 3714)
    file: "s1_1563568_000143774926013504.htm",
    dir: "s1",
    cik: "1563568",
    accession: "000143774926013504",
    primaryDoc: "adom20260417_s1.htm",
    transform: "verbatim",
    remoteSha256: "7724f191873c6869f8a694840f10edb8191b3a9723f96095cba2d08c71859d67",
    sha256: "7724f191873c6869f8a694840f10edb8191b3a9723f96095cba2d08c71859d67",
    bytes: 442920,
  },
  {
    // FingerMotion, Inc. (SIC 7372)
    file: "s1_1602409_000152013826000232.htm",
    dir: "s1",
    cik: "1602409",
    accession: "000152013826000232",
    primaryDoc: "fngr-06112026_s1.htm",
    transform: "verbatim",
    remoteSha256: "fb0120d60578e2e073b5f6a1f049bd59d520daadb5658be7a74be41762fd85dd",
    sha256: "fb0120d60578e2e073b5f6a1f049bd59d520daadb5658be7a74be41762fd85dd",
    bytes: 1644137,
  },
  {
    // Spire Global, Inc. (SIC 4899)
    file: "s1_1816017_000119312526173846.htm",
    dir: "s1",
    cik: "1816017",
    accession: "000119312526173846",
    primaryDoc: "spir-20260423.htm",
    transform: "verbatim",
    remoteSha256: "a2d069660fae1798e116e29b52247ca5778985ed325c8a6bba0027f976924763",
    sha256: "a2d069660fae1798e116e29b52247ca5778985ed325c8a6bba0027f976924763",
    bytes: 492496,
  },
  {
    // OneMedNet Corp (SIC 8731)
    file: "s1_1849380_000149315226031598.htm",
    dir: "s1",
    cik: "1849380",
    accession: "000149315226031598",
    primaryDoc: "forms-1.htm",
    transform: "verbatim",
    remoteSha256: "7551ebc78c17c22a39eaac58d9b1afd59e724f307baecd7336a262809ba13a66",
    sha256: "7551ebc78c17c22a39eaac58d9b1afd59e724f307baecd7336a262809ba13a66",
    bytes: 3158797,
  },
  {
    // Lincoln International, Inc. (SIC 6282)
    file: "s1_1925283_000162828026027260.htm",
    dir: "s1",
    cik: "1925283",
    accession: "000162828026027260",
    primaryDoc: "lincolninternational-sx1xa.htm",
    transform: "verbatim",
    remoteSha256: "042d887682be5e3a8c2fbba7dcc3aeabccd0a61a502a9ac094283ebb86e67b00",
    sha256: "042d887682be5e3a8c2fbba7dcc3aeabccd0a61a502a9ac094283ebb86e67b00",
    bytes: 2924286,
  },
  {
    // First Tracks Biotherapeutics (SIC 2834)
    file: "s1_2091349_000119312526214778.htm",
    dir: "s1",
    cik: "2091349",
    accession: "000119312526214778",
    primaryDoc: "d53570ds1.htm",
    transform: "verbatim",
    remoteSha256: "93170b3d17647fa2302c8883fc7355c1196d8021355e96897e3e3f9f1f965a5a",
    sha256: "93170b3d17647fa2302c8883fc7355c1196d8021355e96897e3e3f9f1f965a5a",
    bytes: 1745291,
  },
  {
    // Greenland Energy Co (SIC 1381)
    file: "s1_2093507_000182912626003406.htm",
    dir: "s1",
    cik: "2093507",
    accession: "000182912626003406",
    primaryDoc: "greenlandenergy_s1.htm",
    transform: "verbatim",
    remoteSha256: "fafd75056f8919da5aa6094e6007f1fa8fa3ca7743fdd5c02df268df615a57a5",
    sha256: "fafd75056f8919da5aa6094e6007f1fa8fa3ca7743fdd5c02df268df615a57a5",
    bytes: 2940137,
  },
  {
    // Quantinuum Inc. (SIC 7373)
    file: "s1_2110105_000162828026032836.htm",
    dir: "s1",
    cik: "2110105",
    accession: "000162828026032836",
    primaryDoc: "quantinuum-sx1.htm",
    transform: "verbatim",
    remoteSha256: "24b19c4d83172456c720a5a602a707297fb956e84183718721cbce326c70fa11",
    sha256: "24b19c4d83172456c720a5a602a707297fb956e84183718721cbce326c70fa11",
    bytes: 3419233,
  },
  {
    // Ideal Power Inc. — an operating-company S-1 (not a SPAC), which is why it
    // is in the corpus: it keeps the extractors honest about filings whose
    // management and ownership tables carry none of the SPAC conventions.
    // It carried golden labels for two extractors while unpinned here, so
    // nothing would have caught it drifting or being hand-edited — and it is
    // the fixture that once went missing from the vendored copy and silently
    // under-scored every eval run.
    file: "s1_1507957_000143774926010088.htm",
    dir: "s1",
    cik: "1507957",
    accession: "000143774926010088",
    primaryDoc: "ipwr20260319_s1.htm",
    transform: "verbatim",
    remoteSha256: "4fde74a69a05f32c2654faa104ebaf3a9d3c460d762760fc48609438db6d3b6c",
    sha256: "4fde74a69a05f32c2654faa104ebaf3a9d3c460d762760fc48609438db6d3b6c",
    bytes: 467089,
  },
  {
    // Virtuix Holdings Inc. (SIC 3577) — VR treadmills. One of six operating
    // companies added to balance the corpus at 10 SPACs / 10 operating: the
    // SPAC-shaped extractors (spac-classification, spac-profile,
    // sponsor-promote) can only be shown to reject a non-SPAC if the corpus
    // actually contains enough of them. No THE_OFFERING section.
    file: "s1_1606242_000121390026054471.htm",
    dir: "s1",
    cik: "1606242",
    accession: "000121390026054471",
    primaryDoc: "ea0282570-s1_virtuix.htm",
    transform: "verbatim",
    remoteSha256: "5442a0f25e9d44d21a67b9fe0eeed18c709929e56fb642a0d9a021a16f85736c",
    sha256: "5442a0f25e9d44d21a67b9fe0eeed18c709929e56fb642a0d9a021a16f85736c",
    bytes: 2630965,
  },
  {
    // Kodiak AI, Inc. (SIC 7373) — autonomous trucking IPO. Carries MANAGEMENT
    // and a large EXECUTIVE_COMPENSATION but no PRINCIPAL_AND_SELLING_STOCKHOLDERS.
    file: "s1_1853138_000162828026039200.htm",
    dir: "s1",
    cik: "1853138",
    accession: "000162828026039200",
    primaryDoc: "kdk-20260529.htm",
    transform: "verbatim",
    remoteSha256: "0082fd24840a4302483aaadf5dfdc69067c26c1f6a9c3250dea20615421262c8",
    sha256: "0082fd24840a4302483aaadf5dfdc69067c26c1f6a9c3250dea20615421262c8",
    bytes: 3663684,
  },
  {
    // Direct Digital Holdings, Inc. (SIC 7310) — advertising. Full nine-section
    // coverage.
    file: "s1_1880613_000162828026005423.htm",
    dir: "s1",
    cik: "1880613",
    accession: "000162828026005423",
    primaryDoc: "drct-20260204.htm",
    transform: "verbatim",
    remoteSha256: "3fcacc1ca5deb8e7fdbfcb63e7ead6b910b5851c6ef804ba701267e316ca738b",
    sha256: "3fcacc1ca5deb8e7fdbfcb63e7ead6b910b5851c6ef804ba701267e316ca738b",
    bytes: 3146861,
  },
  {
    // Deep Fission, Inc. (SIC 4911) — small modular reactors. Full coverage.
    file: "s1_1918102_000110465926016226.htm",
    dir: "s1",
    cik: "1918102",
    accession: "000110465926016226",
    primaryDoc: "tmb-20250930xs1.htm",
    transform: "verbatim",
    remoteSha256: "818ae6ecc1d2e62ac23e6be4bcc7eef21ed2c3ffccac3e30c1a612b03d446592",
    sha256: "818ae6ecc1d2e62ac23e6be4bcc7eef21ed2c3ffccac3e30c1a612b03d446592",
    bytes: 3946376,
  },
  {
    // Factorial Energy Inc. (SIC 3690) — solid-state batteries. The largest
    // fixture in the corpus at 7 MB, which is what makes it worth carrying.
    file: "s1_2049662_000110465926079324.htm",
    dir: "s1",
    cik: "2049662",
    accession: "000110465926079324",
    primaryDoc: "tmb-20260331xs1.htm",
    transform: "verbatim",
    remoteSha256: "bfda6c636b80b1b6a22232c3d138cdc3640c47fdf034a10b44468570b006cb24",
    sha256: "bfda6c636b80b1b6a22232c3d138cdc3640c47fdf034a10b44468570b006cb24",
    bytes: 7073235,
  },
  {
    // Matternet, Inc. (SIC 3721) — drone logistics. Full coverage.
    file: "s1_2075109_000121390026073335.htm",
    dir: "s1",
    cik: "2075109",
    accession: "000121390026073335",
    primaryDoc: "ea0294588-s1_matternet.htm",
    transform: "verbatim",
    remoteSha256: "16cff0c10caff0c6ad3b5fa2348ac3e2aa1daea320376e4e306f286118a6c4af",
    sha256: "16cff0c10caff0c6ad3b5fa2348ac3e2aa1daea320376e4e306f286118a6c4af",
    bytes: 3192383,
  },
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
    // Gold Mountain Acquisition Corp. — 2026 SPAC filed through M2 Compliance
    // (`forms-1.htm`). Added for filing-agent diversity: the corpus previously
    // covered only three agents, so the segmenter was only ever exercised
    // against three HTML generators.
    file: "s1_2105318_000149315226031978.htm",
    dir: "s1",
    cik: "2105318",
    accession: "000149315226031978",
    primaryDoc: "forms-1.htm",
    transform: "verbatim",
    remoteSha256: "be8a069c1690972c679443f41f3746ac24bc319a52a2673bbef5c861de110120",
    sha256: "be8a069c1690972c679443f41f3746ac24bc319a52a2673bbef5c861de110120",
    bytes: 2300623,
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
    // Karman Line Acquisition Corp. — 2026 SPAC, tenth of ten. Carried
    // deliberately as the SECOND filing that resolves no MANAGEMENT section
    // (Material Resource is the first): one such filing reads as a curiosity,
    // two out of ten SPACs establishes that the roster-heading gap is a
    // recurring shape and not a single malformed document.
    file: "s1_2134856_000182912626007847.htm",
    dir: "s1",
    cik: "2134856",
    accession: "000182912626007847",
    primaryDoc: "karmanlineacq_s1.htm",
    transform: "verbatim",
    remoteSha256: "60c7fb83627a60daada5b6e6345dc73000afd5c9274b4290a1b0fe750eb9caf3",
    sha256: "60c7fb83627a60daada5b6e6345dc73000afd5c9274b4290a1b0fe750eb9caf3",
    bytes: 2730289,
  },
  {
    // Southern Cross Acquisition II Corp. — 2026 SPAC, self-filed (its own CIK
    // is the filing agent) rather than produced by one of the big four agents.
    file: "s1_2133239_000192998026000317.htm",
    dir: "s1",
    cik: "2133239",
    accession: "000192998026000317",
    primaryDoc: "scacii_s1.htm",
    transform: "verbatim",
    remoteSha256: "bd1458b94aee61bc3b15e5117b252dd37e5d86f3ed6ad77861fc9679826b50c1",
    sha256: "bd1458b94aee61bc3b15e5117b252dd37e5d86f3ed6ad77861fc9679826b50c1",
    bytes: 2434037,
  },
  {
    // Albatross Acquisition Corp — 2026 SPAC via a fourth filing agent
    // (0001829126), whose `*_s1.htm` output is another distinct HTML generator.
    file: "s1_2135163_000182912626006553.htm",
    dir: "s1",
    cik: "2135163",
    accession: "000182912626006553",
    primaryDoc: "albatrossacq_s1.htm",
    transform: "verbatim",
    remoteSha256: "16561eb4362d68aabebf037b7caea223db01f31de4f88f26513aff81916f8f0b",
    sha256: "16561eb4362d68aabebf037b7caea223db01f31de4f88f26513aff81916f8f0b",
    bytes: 2021433,
  },
  {
    // Material Resource Acquisition Corp. — 2026 SPAC, self-filed and named
    // `mracs1-plain.htm`: markup noticeably plainer than agent-generated
    // filings, which is exactly the shape a table-driven segmenter is most
    // likely to mis-handle.
    file: "s1_2136360_000213636026000003.htm",
    dir: "s1",
    cik: "2136360",
    accession: "000213636026000003",
    primaryDoc: "mracs1-plain.htm",
    transform: "verbatim",
    remoteSha256: "5a2010290e5f0f9a1d89420b76cf9ee9bbb18d6da33b4a102f5d2d9276d03ffb",
    sha256: "5a2010290e5f0f9a1d89420b76cf9ee9bbb18d6da33b4a102f5d2d9276d03ffb",
    bytes: 1573506,
  },
  {
    // Rainier Acquisition Corp — 2026 Cayman SPAC. Its ownership table is four
    // all-dash rows (officers/nominees holding nothing) plus an unnamed "[·]"
    // placeholder nominee in the roster, which is what earns it a place here.
    file: "s1_2147219_000110465926092088.htm",
    dir: "s1",
    cik: "2147219",
    accession: "000110465926092088",
    primaryDoc: "tmb-20260806xs1.htm",
    transform: "verbatim",
    remoteSha256: "461d9644ca906eff6538188a823f0a140e1e35efb91904ae4e92e17ec9652a36",
    sha256: "461d9644ca906eff6538188a823f0a140e1e35efb91904ae4e92e17ec9652a36",
    bytes: 2946182,
  },
  {
    // KiNRG, Inc. — a small operating-company IPO with no director nominees and
    // an ownership table whose rows sit under a printed category label rather
    // than starting straight in. The non-SPAC counterweight to the corpus.
    file: "s1_95572_000121390026086369.htm",
    dir: "s1",
    cik: "95572",
    accession: "000121390026086369",
    primaryDoc: "ea0300773-s1_kinrg.htm",
    transform: "verbatim",
    remoteSha256: "abf51f32faf72a4f257eae3a2d989619389745821c3bcb1c935d1c5dcda4d17d",
    sha256: "abf51f32faf72a4f257eae3a2d989619389745821c3bcb1c935d1c5dcda4d17d",
    bytes: 3331697,
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
