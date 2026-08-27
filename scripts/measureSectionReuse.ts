/**
 * How much extraction work an amendment family actually repeats.
 *
 * An S-1, its amendments and the 424B4 that prices the deal are largely the
 * same document, which invites a content-addressed cache in front of the
 * extractor: hash what you are about to send, skip the call if you have sent it
 * before. Whether that pays is entirely a question of GRANULARITY, and this
 * measures it rather than assuming it.
 *
 * Sample size turned out to matter more than any other variable. A first pass
 * over TWO families put reuse at 2.3% of characters at the granularity most
 * extractors run at; twenty-five families put the same figure at 11.4%. The
 * difference is how far apart the amendments are — filings days apart share
 * most of their sections, filings months apart share almost none — and two
 * families cannot sample that. Run it over a corpus, not an example.
 *
 * Four granularities, because they are four different answers:
 *
 * - `section`      — `DocumentTreeSegmenter` named sections. What every
 *                    extractor except risk factors is called with today, so
 *                    this is the number that decides whether a cache pays NOW.
 * - `risk-chunk`   — `chunkRiskFactorText` over Risk Factors. The one extractor
 *                    already split into small calls, and so a preview of what
 *                    the others would look like if they were.
 * - `heading-chunk`— the `filing_section` split the filing viewer stores.
 * - `paragraph`    — nothing extracts at this granularity; it is the ceiling,
 *                    the most any chunking scheme could recover.
 *
 * And two cache SCOPES, because they answer different questions:
 *
 * - `family` — hashes shared only within one issuer's S-1 chain. What a cache
 *              keyed per filing family would save.
 * - `global` — hashes shared across every issuer in the run. SPAC prospectuses
 *              are drafted from a handful of law-firm templates, so boilerplate
 *              risk factors may well repeat across unrelated issuers; if that
 *              holds, the global number is the one that matters and it is
 *              invisible to any per-family design.
 *
 * Streams rather than hoards: each document is fetched, parsed, hashed and
 * discarded. Only hashes are kept, so the run's memory is a few MB regardless
 * of corpus size and it needs no disk at all.
 *
 * Plain `fetch` with a fixed delay rather than the repo's own rate-limited
 * queue: that queue comes up with the whole DI bootstrap, and this script reads
 * nothing from the database. The delay is set well under EDGAR's published 10
 * requests/second.
 *
 * Filers come from the committed fixture corpus by default — 42 real S-1
 * filers whose provenance `mock_data/s1/SOURCES.md` already records. They are
 * HISTORICAL, which is the property that matters: an S-1 filed this week has no
 * amendments yet, so sampling EDGAR's recent-filings feed would measure mostly
 * one-document families and report a hit rate of zero for reasons that have
 * nothing to do with caching. `--recent` adds today's filers on top for a
 * recency check, and `--sic` adds a browse-EDGAR page of one industry code.
 *
 *   bun scripts/measureSectionReuse.ts [--families 25] [--recent] [--sic 6770] [--json out.json]
 */

import { parseEdgarHtml } from "../src/sec/html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "../src/sec/forms/registration-statements/s1/DocumentTreeSegmenter";
import { chunkRiskFactorText } from "../src/sec/forms/registration-statements/s1/riskFactorChunks";
import { splitDocumentSections } from "../src/sec/document/documentSections";
import { sectionHash } from "../src/verify/callTrace";

const UA = process.env.SEC_USER_AGENT ?? "workglow-sec research contact@workglow.dev";
/** Well under EDGAR's published 10 req/s, matching the repo's own default rate. */
const REQUEST_DELAY_MS = 260;

/**
 * Documents larger than this are skipped rather than parsed.
 *
 * A handful of registration statements run past 50 MB — an insurance separate
 * account registering hundreds of contracts — and one of them costs more parse
 * time than the rest of the corpus put together while telling us nothing about
 * amendment reuse.
 */
const MAX_DOC_BYTES = 25 * 1024 * 1024;

const GRANULARITIES = ["section", "risk-chunk", "heading-chunk", "paragraph"] as const;
type Granularity = (typeof GRANULARITIES)[number];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const pad10 = (cik: string | number): string => String(cik).replace(/\D/g, "").padStart(10, "0");

interface FamilyFiling {
  readonly form: string;
  readonly filingDate: string;
  readonly accession: string;
  readonly primaryDoc: string;
}

interface Family {
  readonly cik: string;
  readonly name: string;
  readonly filings: readonly FamilyFiling[];
}

/** Running totals for one granularity under one scope. */
interface Tally {
  calls: number;
  hits: number;
  charsSent: number;
  charsSaved: number;
}

const emptyTally = (): Tally => ({ calls: 0, hits: 0, charsSent: 0, charsSaved: 0 });

/**
 * Fetched through `curl` rather than `fetch`.
 *
 * Not a preference: in a sandbox whose egress goes through a CONNECT proxy,
 * Bun's fetch does not pick up the proxy environment and every request dies as
 * "socket connection was closed unexpectedly" without the proxy ever recording
 * an attempt. curl reads the standard proxy and CA variables, so it works
 * everywhere this script might run, including plainly on a laptop.
 *
 * `--fail-with-body` makes an HTTP error an exit code, so a 403 or a 503 is a
 * throw here instead of an EDGAR error page silently parsed as a filing.
 */
async function getText(url: string): Promise<string> {
  const proc = Bun.spawn(
    ["curl", "-sS", "--fail-with-body", "--max-time", "120", "-H", `User-Agent: ${UA}`, url],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [body, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`curl ${code}: ${err.trim() || url}`);
  return body;
}

/**
 * The filers whose S-1 chains this run measures.
 *
 * The committed fixture corpus is the default source and needs no network: the
 * filenames carry the CIK, `SOURCES.md` records where each came from, and every
 * one is old enough for its amendment chain to be complete. The two EDGAR feeds
 * are opt-in supplements.
 *
 * Sequential, with the same delay as every other request. Issued in parallel,
 * browse-EDGAR answers 503 to BOTH and a swallowed failure reports itself as an
 * empty corpus — which is exactly how this script first reported "0 candidate
 * CIKs" against feeds that were working.
 */
async function sourceCiks(opts: {
  readonly fixturesDir: string;
  readonly sic: string | undefined;
  readonly recent: boolean;
  readonly want: number;
}): Promise<string[]> {
  const ciks: string[] = [];

  const { readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  for (const sub of ["s1", "424"]) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(opts.fixturesDir, sub));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const match = /^[a-z0-9]+_(\d+)_/.exec(entry);
      if (match) ciks.push(match[1]);
    }
  }
  console.log(`  ${new Set(ciks).size} from the fixture corpus`);

  if (opts.sic !== undefined) {
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&SIC=${opts.sic}&type=S-1&dateb=&owner=include&count=${opts.want * 3}&output=atom`;
    try {
      const xml = await getText(url);
      const found = [...xml.matchAll(/CIK=(\d+)/g)].map((m) => m[1]);
      ciks.push(...found);
      console.log(`  ${new Set(found).size} from SIC ${opts.sic}`);
    } catch (err) {
      console.log(`  SIC ${opts.sic} lookup failed: ${(err as Error).message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  if (opts.recent) {
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=S-1&count=${opts.want * 3}&output=atom`;
    try {
      const xml = await getText(url);
      const found = [...xml.matchAll(/edgar\/data\/(\d+)/g)].map((m) => m[1]);
      ciks.push(...found);
      // Named rather than merged silently: these filers are days old, so most
      // will have no amendment yet and will be dropped as one-filing families.
      console.log(`  ${new Set(found).size} from today's S-1 feed (families likely incomplete)`);
    } catch (err) {
      console.log(`  recent-filings lookup failed: ${(err as Error).message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return [...new Set(ciks)];
}

/**
 * The S-1 chain for one CIK: the registration, its amendments and the
 * prospectus that priced it, oldest first.
 *
 * `S-1MEF` is included — it is part of the chain — but a family needs at least
 * two documents to say anything about reuse, so a lone S-1 is dropped.
 */
async function familyFor(cik: string): Promise<Family | null> {
  const sub = JSON.parse(
    await getText(`https://data.sec.gov/submissions/CIK${pad10(cik)}.json`)
  ) as {
    name: string;
    filings: {
      recent: {
        form: string[];
        filingDate: string[];
        accessionNumber: string[];
        primaryDocument: string[];
      };
    };
  };
  const r = sub.filings.recent;
  const filings: FamilyFiling[] = [];
  for (let i = 0; i < r.form.length; i += 1) {
    const form = r.form[i];
    if (!/^(S-1|S-1\/A|S-1MEF|F-1|F-1\/A|424B[1-8])$/.test(form)) continue;
    const primaryDoc = r.primaryDocument[i] ?? "";
    // A chain member with no HTML primary document cannot be parsed, and
    // counting it as a miss would understate the cache rather than skip it.
    if (!/\.html?$/i.test(primaryDoc)) continue;
    filings.push({
      form,
      filingDate: r.filingDate[i],
      accession: r.accessionNumber[i],
      primaryDoc,
    });
  }
  filings.sort(
    (a, b) => a.filingDate.localeCompare(b.filingDate) || a.accession.localeCompare(b.accession)
  );
  if (filings.length < 2) return null;
  return { cik: String(Number(cik)), name: sub.name, filings };
}

/** Every unit one document contributes, at each granularity. */
function unitsFor(html: string, label: string): Record<Granularity, string[]> {
  const doc = parseEdgarHtml(html, label);
  const segmented = new DocumentTreeSegmenter().segmentDocument(doc);
  const sections = segmented.sections.map((s) => s.text);
  const risk = segmented.sections.find((s) => /risk factors/i.test(s.name))?.text;
  return {
    section: sections,
    "risk-chunk": risk === undefined ? [] : chunkRiskFactorText(risk).map((c) => c.text),
    "heading-chunk": splitDocumentSections(doc).map((c) => c.markdown),
    // Blank-line separated, matching how the converter joins blocks.
    paragraph: sections.flatMap((t) =>
      t
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p !== "")
    ),
  };
}

function record(tally: Tally, seen: Set<string>, units: readonly string[]): void {
  for (const text of units) {
    const key = sectionHash(text);
    tally.calls += 1;
    if (seen.has(key)) {
      tally.hits += 1;
      tally.charsSaved += text.length;
    } else {
      seen.add(key);
      tally.charsSent += text.length;
    }
  }
}

const pct = (a: number, b: number): string =>
  b === 0 ? "  n/a" : `${((100 * a) / b).toFixed(1)}%`;

function reportTable(title: string, tallies: Record<Granularity, Tally>): void {
  console.log(`\n${title}`);
  console.log(
    `  ${"granularity".padEnd(16)} ${"units".padStart(8)} ${"hits".padStart(8)} ${"hit rate".padStart(9)} ${"chars saved".padStart(13)}`
  );
  for (const g of GRANULARITIES) {
    const t = tallies[g];
    console.log(
      `  ${g.padEnd(16)} ${String(t.calls).padStart(8)} ${String(t.hits).padStart(8)} ${pct(t.hits, t.calls).padStart(9)} ${pct(t.charsSaved, t.charsSent + t.charsSaved).padStart(13)}`
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const wantFamilies = Number(arg("families", "25"));
  const sic = argv.includes("--sic") ? arg("sic", "6770") : undefined;
  const recent = argv.includes("--recent");
  const fixturesDir = arg("fixtures", "src/sec/html/mock_data");
  const jsonOut = argv.indexOf("--json") >= 0 ? arg("json", "") : "";

  console.log(`Discovering S-1 families, target ${wantFamilies}…`);
  const ciks = await sourceCiks({ fixturesDir, sic, recent, want: wantFamilies });
  console.log(`  ${ciks.length} candidate CIKs total`);

  const families: Family[] = [];
  for (const cik of ciks) {
    if (families.length >= wantFamilies) break;
    try {
      const family = await familyFor(cik);
      if (family !== null) {
        families.push(family);
        console.log(`  + ${family.name.slice(0, 44).padEnd(45)} ${family.filings.length} filings`);
      }
    } catch {
      /* an unreachable or odd filer is not a finding */
    }
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(
    `\n${families.length} families, ${families.reduce((n, f) => n + f.filings.length, 0)} documents\n`
  );

  const global: Record<Granularity, Tally> = Object.fromEntries(
    GRANULARITIES.map((g) => [g, emptyTally()])
  ) as Record<Granularity, Tally>;
  const globalSeen: Record<Granularity, Set<string>> = Object.fromEntries(
    GRANULARITIES.map((g) => [g, new Set<string>()])
  ) as Record<Granularity, Set<string>>;
  const perFamily: Record<Granularity, Tally> = Object.fromEntries(
    GRANULARITIES.map((g) => [g, emptyTally()])
  ) as Record<Granularity, Tally>;

  const rows: Record<string, unknown>[] = [];
  let parsed = 0;
  let skipped = 0;

  for (const [index, family] of families.entries()) {
    const familySeen: Record<Granularity, Set<string>> = Object.fromEntries(
      GRANULARITIES.map((g) => [g, new Set<string>()])
    ) as Record<Granularity, Set<string>>;
    const familyTally: Record<Granularity, Tally> = Object.fromEntries(
      GRANULARITIES.map((g) => [g, emptyTally()])
    ) as Record<Granularity, Tally>;

    console.log(
      `[${index + 1}/${families.length}] ${family.name.slice(0, 50)} (CIK ${family.cik})`
    );
    for (const filing of family.filings) {
      const url = `https://www.sec.gov/Archives/edgar/data/${family.cik}/${filing.accession.replaceAll("-", "")}/${filing.primaryDoc}`;
      let html: string;
      try {
        html = await getText(url);
      } catch (err) {
        console.log(
          `    ${filing.form.padEnd(8)} ${filing.filingDate}  fetch failed: ${(err as Error).message}`
        );
        skipped += 1;
        await sleep(REQUEST_DELAY_MS);
        continue;
      }
      await sleep(REQUEST_DELAY_MS);
      if (html.length > MAX_DOC_BYTES) {
        console.log(
          `    ${filing.form.padEnd(8)} ${filing.filingDate}  skipped, ${(html.length / 1048576).toFixed(0)} MB`
        );
        skipped += 1;
        continue;
      }
      let units: Record<Granularity, string[]>;
      try {
        units = unitsFor(html, `${filing.form} ${filing.accession}`);
      } catch (err) {
        console.log(
          `    ${filing.form.padEnd(8)} ${filing.filingDate}  parse failed: ${(err as Error).message}`
        );
        skipped += 1;
        continue;
      }
      parsed += 1;
      const before = { ...familyTally.section };
      for (const g of GRANULARITIES) {
        record(familyTally[g], familySeen[g], units[g]);
        record(global[g], globalSeen[g], units[g]);
      }
      const sectionHits = familyTally.section.hits - before.hits;
      console.log(
        `    ${filing.form.padEnd(8)} ${filing.filingDate}  ${String(units.section.length).padStart(2)} sections (${sectionHits} cached)` +
          `  ${String(units["risk-chunk"].length).padStart(2)} risk chunks  ${String(units.paragraph.length).padStart(4)} paragraphs`
      );
    }

    for (const g of GRANULARITIES) {
      perFamily[g].calls += familyTally[g].calls;
      perFamily[g].hits += familyTally[g].hits;
      perFamily[g].charsSent += familyTally[g].charsSent;
      perFamily[g].charsSaved += familyTally[g].charsSaved;
    }
    rows.push({
      cik: family.cik,
      name: family.name,
      filings: family.filings.length,
      tallies: Object.fromEntries(GRANULARITIES.map((g) => [g, { ...familyTally[g] }])),
    });
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${families.length} families · ${parsed} documents parsed · ${skipped} skipped`);
  reportTable("SCOPE: family — a cache keyed per issuer's S-1 chain", perFamily);
  reportTable("SCOPE: global — one cache across every issuer in this run", global);
  console.log(
    "\n`section` is what every extractor but risk factors is called with today.\n" +
      "`paragraph` is the ceiling: no scheme recovers more than that.\n"
  );

  if (jsonOut !== "") {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      jsonOut,
      JSON.stringify({ families: rows, perFamily, global, parsed, skipped }, null, 2)
    );
    console.log(`wrote ${jsonOut}`);
  }
}

await main();
