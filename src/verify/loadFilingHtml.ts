/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { SEC_RAW_DATA_FOLDER } from "../config/tokens";
import { EntityRepo } from "../storage/entity/EntityRepo";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { SecFetchAccessionDocTask } from "../task/forms/SecFetchAccessionDocTask";
import { fullSubmissionFileName, submissionFetchKind } from "../task/forms/submissionFetchPolicy";
import { cachedAccessionDocPath, resolvePrimaryDocName } from "../util/accessionDocPath";
import { resolveAsset } from "../util/resolveAsset";

/** Where a filing's HTML came from, so a trace says what it is a trace of. */
export interface FilingSource {
  readonly kind: "fixture" | "file" | "cache" | "fetch";
  readonly label: string;
  readonly html: string;
}

const fixtureDirs = (): string[] => [
  ...(process.env.SEC_S1_MOCK_DIR ? [process.env.SEC_S1_MOCK_DIR] : []),
  join(import.meta.dirname, "../sec/html/mock_data/s1"),
  join(import.meta.dirname, "sec/html/mock_data/s1"),
];

/** Committed fixture names, for a `--fixture` picker and for sweeping the corpus. */
export function listFixtures(): readonly string[] {
  const dir = resolveAsset(fixtureDirs());
  return readdirSync(dir)
    .filter((name) => name !== "SOURCES.md")
    .sort();
}

/**
 * Resolve one filing to HTML.
 *
 * A cached accession is read straight from disk rather than through the fetch
 * queue: a trace is a triage tool run repeatedly on the same filing, and
 * spending EDGAR's shared rate budget to re-read a document already on disk
 * would make the tool the reason the sweep behind it slows down.
 */
export async function loadFilingHtml(
  args: {
    readonly fixture?: string | undefined;
    readonly file?: string | undefined;
    readonly cik?: number | undefined;
    readonly accession?: string | undefined;
    readonly allowFetch?: boolean | undefined;
  },
  context?: IExecuteContext
): Promise<FilingSource> {
  if (args.file !== undefined) {
    return { kind: "file", label: args.file, html: readFileSync(args.file, "utf8") };
  }
  if (args.fixture !== undefined) {
    const dir = resolveAsset(fixtureDirs());
    const path = join(dir, args.fixture);
    if (!existsSync(path)) {
      throw new Error(`No committed fixture named "${args.fixture}" in ${dir}`);
    }
    return { kind: "fixture", label: args.fixture, html: readFileSync(path, "utf8") };
  }
  const { cik, accession } = args;
  if (cik === undefined || accession === undefined) {
    throw new Error("Give a --fixture, a --file, or both a CIK and an accession number");
  }

  // The fixture and file forms of these commands run without a configured CLI;
  // this one cannot. Checked here so the answer is the instruction rather than
  // an unregistered-token error from inside the repository.
  if (!globalServiceRegistry.has(FILING_REPOSITORY_TOKEN)) {
    throw new Error(
      "Looking up an accession needs a configured database — run `sec init`, or verify a --fixture or --file instead"
    );
  }
  const filing = await new EntityRepo().getFiling(cik, accession);
  const primaryDoc = resolvePrimaryDocName(filing?.primary_doc);
  const form = filing?.form ?? null;
  // WHICH FILE is on disk is `submissionFetchKind`'s answer, not this module's.
  // The registration family, Reg A annual reports and every 8-K are cached as
  // the whole-submission `.txt`, so probing the primary document alone reported
  // every one of them as uncached however many times the sweep had already
  // downloaded it — and `--fetch` then wrote a SECOND shape on disk for one
  // filing, which is the drift the shared policy exists to end.
  const candidates: string[] = [];
  if (form !== null && submissionFetchKind(form) === "full-submission") {
    candidates.push(fullSubmissionFileName(accession));
  }
  if (primaryDoc !== undefined) candidates.push(primaryDoc);
  if (candidates.length === 0) {
    throw new Error(
      `No primary document recorded for ${cik}/${accession} — the filing is not in the local database, or it names none`
    );
  }
  // What a miss fetches: the head of the list, i.e. what the policy says the
  // pipeline would have fetched anyway.
  const fileName = candidates[0]!;

  if (globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
    const root = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    for (const candidate of candidates) {
      const path = cachedAccessionDocPath(root, cik, accession, candidate);
      if (path === undefined) continue;
      try {
        return {
          kind: "cache",
          label: `${accession}/${candidate}`,
          html: await readFile(path, "utf-8"),
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
      }
    }
  }

  if (args.allowFetch !== true || context === undefined) {
    throw new Error(
      `${cik}/${accession}/${fileName} is not in the local fetch cache. Re-run with --fetch to download it from EDGAR.`
    );
  }
  const task = context.own(
    new SecFetchAccessionDocTask(
      { cik, accessionNumber: accession, fileName },
      { title: `Fetch ${accession} ${fileName}` }
    )
  );
  try {
    const { text } = await task.run();
    if (!text) throw new Error(`EDGAR returned no body for ${cik}/${accession}/${fileName}`);
    return { kind: "fetch", label: `${accession}/${fileName}`, html: text };
  } finally {
    context.disown(task);
  }
}
