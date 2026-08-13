/**
 * One-off inventory: committed S-1 mock files × golden labels × embarc unit terms.
 * Run from sec/: bun tmp-inventory-golden.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { GOLDEN_S1_LABELS } from "./src/eval/goldenS1Labels.ts";

const S1_DIR = "src/sec/html/mock_data/s1";
const UNIT_CSV = "src/eval/mock_data/embarc-spac-unit-terms.csv";
const EXTRACTORS = [
  "spac-classification",
  "spac-profile",
  "spac-sponsors",
  "sponsor-promote",
  "offering-terms",
  "management",
  "beneficial-ownership",
  "related-party",
  "underwriters",
  "use-of-proceeds",
  "executive-compensation",
  "risk-factors",
];

function parseCikFromFilename(file) {
  const m = file.match(/^(?:s1|f1|drs)_(\d+)_(\d+)\.(htm|txt)$/);
  if (!m) return null;
  return { cik: m[1], accession: m[2], ext: m[3], filing: file.replace(/\.(htm|txt)$/, "") };
}

function extractNameFromHtml(path) {
  const html = readFileSync(path, "utf8");
  const head = html.slice(0, 80000);
  const patterns = [
    /<COMPANY-CONFORMED-NAME>\s*([^<\n]+)/i,
    /COMPANY CONFORMED NAME:\s*([^\n<]+)/i,
    /<CONFORMED-NAME>\s*([^<\n]+)/i,
    /<title[^>]*>([^<]+)<\/title>/i,
    /dei:EntityRegistrantName[^>]*>([^<]+)</i,
  ];
  for (const re of patterns) {
    const m = head.match(re);
    if (m) {
      let name = m[1].trim().replace(/\s+/g, " ");
      name = name.replace(/\s*[-–|]\s*SEC\.gov.*$/i, "");
      name = name.replace(/\s*Form\s+S-1.*$/i, "");
      if (name && name.length < 120) return name;
    }
  }
  return null;
}

function parseUnitCsv(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.trim().split("\n");
  const header = lines[0].split(",");
  const byCik = new Map();
  for (const line of lines.slice(1)) {
    const cols = [];
    let cur = "";
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) {
        cols.push(cur);
        cur = "";
      } else cur += ch;
    }
    cols.push(cur);
    const row = Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ""]));
    byCik.set(String(Number(row.cik)), row);
  }
  return byCik;
}

const files = readdirSync(S1_DIR)
  .filter((f) => /\.(htm|txt)$/.test(f))
  .sort();

const unitByCik = parseUnitCsv(UNIT_CSV);

const fixtures = [];
for (const file of files) {
  const parsed = parseCikFromFilename(file);
  if (!parsed) {
    fixtures.push({ file, kind: "unparsed" });
    continue;
  }
  const name = extractNameFromHtml(join(S1_DIR, file));
  const labels = {};
  const empty = [];
  const populated = [];
  for (const ext of EXTRACTORS) {
    const key = `${parsed.filing}::${ext}`;
    if (key in GOLDEN_S1_LABELS) {
      const rows = GOLDEN_S1_LABELS[key];
      labels[ext] = rows.length;
      if (rows.length === 0) empty.push(ext);
      else populated.push(ext);
    }
  }
  const classKey = `${parsed.filing}::spac-classification`;
  let spac = "unlabelled";
  if (classKey in GOLDEN_S1_LABELS) {
    const rows = GOLDEN_S1_LABELS[classKey];
    spac = rows.length > 0 ? "spac" : "not-spac";
  }
  const unit = unitByCik.get(String(Number(parsed.cik)));
  fixtures.push({
    file,
    filing: parsed.filing,
    cik: parsed.cik,
    accession: parsed.accession,
    ext: parsed.ext,
    name,
    spac,
    labelledExtractors: Object.keys(labels).length,
    populated,
    empty,
    labels,
    unitTerms: unit
      ? {
          name: unit.name,
          unit_price: unit.unit_price,
          warrant_fraction_per_unit: unit.warrant_fraction_per_unit,
          right_fraction_per_unit: unit.right_fraction_per_unit,
          warrant_ratio: unit.warrant_ratio,
          warrant_price: unit.warrant_price,
        }
      : null,
  });
}

// Golden keys whose filing file is missing
const fixtureFilings = new Set(fixtures.map((f) => f.filing).filter(Boolean));
const orphanKeys = Object.keys(GOLDEN_S1_LABELS).filter((k) => {
  const filing = k.split("::")[0];
  return !fixtureFilings.has(filing);
});

// Extractor coverage counts
const extractorStats = {};
for (const ext of EXTRACTORS) {
  extractorStats[ext] = { labelled: 0, empty: 0, populated: 0, spacPop: 0, spacEmpty: 0, spacMissing: 0 };
}
for (const f of fixtures) {
  if (f.ext !== "htm") continue;
  for (const ext of EXTRACTORS) {
    const n = f.labels?.[ext];
    if (n === undefined) {
      if (f.spac === "spac") extractorStats[ext].spacMissing++;
      continue;
    }
    extractorStats[ext].labelled++;
    if (n === 0) {
      extractorStats[ext].empty++;
      if (f.spac === "spac") extractorStats[ext].spacEmpty++;
    } else {
      extractorStats[ext].populated++;
      if (f.spac === "spac") extractorStats[ext].spacPop++;
    }
  }
}

const htm = fixtures.filter((f) => f.ext === "htm");
const spacs = htm.filter((f) => f.spac === "spac");
const notSpacs = htm.filter((f) => f.spac === "not-spac");
const unlabelled = htm.filter((f) => f.spac === "unlabelled");

const out = {
  summary: {
    htmFixtures: htm.length,
    txtFixtures: fixtures.filter((f) => f.ext === "txt").length,
    goldenKeys: Object.keys(GOLDEN_S1_LABELS).length,
    goldenFilings: new Set(Object.keys(GOLDEN_S1_LABELS).map((k) => k.split("::")[0])).size,
    spac: spacs.length,
    notSpac: notSpacs.length,
    unlabelledSpacClass: unlabelled.length,
    unitTermsRows: unitByCik.size,
    spacWithUnitTerms: spacs.filter((f) => f.unitTerms).length,
    spacWithoutUnitTerms: spacs.filter((f) => !f.unitTerms).map((f) => ({ cik: f.cik, name: f.name })),
    orphanGoldenKeys: orphanKeys,
  },
  extractorStats,
  spacs: spacs.map((f) => ({
    cik: f.cik,
    name: f.name,
    filing: f.filing,
    labelled: f.labelledExtractors,
    populated: f.populated,
    empty: f.empty,
    missing: EXTRACTORS.filter((e) => !(e in f.labels)),
    unitTerms: f.unitTerms,
    labels: f.labels,
  })),
  notSpacs: notSpacs.map((f) => ({
    cik: f.cik,
    name: f.name,
    filing: f.filing,
    labelled: f.labelledExtractors,
    populated: f.populated,
    empty: f.empty,
    missing: EXTRACTORS.filter((e) => !(e in f.labels)),
  })),
  unlabelled,
};

writeFileSync("tmp-inventory-golden.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.summary, null, 2));
console.log("\n=== SPACs ===");
for (const s of out.spacs) {
  console.log(
    `${s.cik.padStart(10)}  ${(s.name ?? "?").slice(0, 42).padEnd(42)}  labelled=${String(s.labelled).padStart(2)}  unit=${s.unitTerms ? "Y" : "n"}  empty=[${s.empty.join(",")}]  missing=[${s.missing.join(",")}]`
  );
}
console.log("\n=== extractor stats ===");
console.log(JSON.stringify(extractorStats, null, 2));
