/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { parseEdgarHtml } from "../../sec/html/parseEdgarHtml";
import { splitDocumentSections } from "../../sec/document/documentSections";
import { FILING_DOCUMENT_REPOSITORY_TOKEN } from "../../storage/document/FilingDocumentSchema";
import {
  FILING_SECTION_REPOSITORY_TOKEN,
  type FilingSection,
} from "../../storage/document/FilingSectionSchema";
import { normalizeAccessionNumber } from "../../util/accession";
import { addTraceOptions, listTraceFixtures, runFilingTrace } from "./filingTrace";
import { isJsonOutput } from "../isJsonOutput";
import { suggest } from "../nextSteps";
import { runCommand } from "../runCommand";

interface ReadOptions {
  readonly section?: string;
  readonly doc?: string;
  readonly list?: boolean;
  readonly trace?: boolean;
  readonly fixtures?: boolean;
  readonly fixture?: string;
  readonly file?: string;
  readonly cik?: number;
  readonly fetch?: boolean;
  readonly out?: string;
  readonly format?: string;
}

/** Sections of one stored filing, in the order that rebuilds the document. */
async function storedSections(accession: string): Promise<FilingSection[]> {
  const repo = globalServiceRegistry.get(FILING_SECTION_REPOSITORY_TOKEN);
  const rows = (await repo.query({ accession_number: accession })) ?? [];
  return [...rows].sort((a, b) => {
    const byFile = a.doc_file.localeCompare(b.doc_file);
    return byFile !== 0 ? byFile : a.ordinal - b.ordinal;
  });
}

/** The message for an accession the database has, but has not converted. */
async function describeMissing(accession: string): Promise<string> {
  const documents = globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN);
  const stored = (await documents.query({ accession_number: accession })) ?? [];
  if (stored.length > 0) {
    return `${accession} has documents stored but no sections. Re-run \`sec update documents --force\`.`;
  }
  return (
    `${accession} has not been converted yet.\n` +
    "  Fetch and convert its company first: `sec get <company>`."
  );
}

export function addReadCommand(program: Command): void {
  const read = program
    .command("read [accession-or-file]")
    .description("A filing as markdown — from the database, or straight off a local HTML file")
    .option("--section <name>", "Only the section whose title or slug matches")
    .option("--doc <file>", "Only this member of the submission")
    .option("--list", "List the sections rather than printing them", false)
    .option("--fixtures", "List the committed golden fixtures --fixture accepts", false)
    .option(
      "--trace",
      "Account for what the parser and segmenter did, instead of printing the filing",
      false
    );
  addTraceOptions(read).action(async (target: string | undefined, options: ReadOptions) => {
    await runCommand(async () => {
      if (options.fixtures === true) {
        for (const name of listTraceFixtures()) console.log(name);
        return;
      }
      // The same filing, measured rather than rendered: a reader holding one
      // and asking "did this convert properly" already has this command.
      if (options.trace === true || options.fixture !== undefined) {
        await runFilingTrace(target, options as never);
        return;
      }
      if (target === undefined) {
        throw new Error("Give an accession number, a local HTML file, or --fixtures.");
      }
      // A path is parsed and printed with no database at all — the parser is
      // the part of this repo most worth trying on your own file, and making
      // that require a configured CLI would hide it behind a setup step.
      if (target.includes("/") || target.toLowerCase().endsWith(".htm")) {
        const html = await readFile(target, "utf-8");
        const sections = splitDocumentSections(parseEdgarHtml(html, target));
        renderSections(
          sections.map((section) => ({ title: section.title, markdown: section.markdown })),
          options
        );
        return;
      }

      const accession = normalizeAccessionNumber(target);
      const rows = await storedSections(accession);
      if (rows.length === 0) {
        throw new Error(await describeMissing(accession));
      }
      const filtered =
        options.doc === undefined ? rows : rows.filter((row) => row.doc_file === options.doc);
      renderSections(filtered, options);

      const docs = new Set(rows.map((row) => row.doc_file));
      if (options.doc === undefined && docs.size > 1 && options.list !== true) {
        suggest({
          command: `sec read ${accession} --list`,
          why: `this submission has ${docs.size} documents`,
        });
      }
    });
  });
}

function renderSections(
  sections: readonly { title: string; markdown: string; slug?: string; doc_file?: string }[],
  options: ReadOptions
): void {
  const needle = options.section?.toLowerCase();
  const selected =
    needle === undefined
      ? sections
      : sections.filter(
          (section) =>
            section.title.toLowerCase().includes(needle) ||
            (section.slug ?? "").toLowerCase().includes(needle)
        );

  if (selected.length === 0) {
    throw new Error(
      `No section matches "${options.section}". Run with --list to see what this filing has.`
    );
  }

  if (isJsonOutput()) {
    console.log(JSON.stringify(selected, null, 2));
    return;
  }

  if (options.list === true) {
    for (const section of selected) {
      const where = section.doc_file === undefined ? "" : `${section.doc_file}  `;
      console.log(`${where}${section.title}  (${section.markdown.length} chars)`);
    }
    return;
  }

  for (const section of selected) console.log(section.markdown);
}
