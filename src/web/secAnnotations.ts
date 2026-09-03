/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildCommandTree,
  registerCommandAnnotation,
  registerCommandFieldAnnotations,
  type CommandFieldAnnotations,
  type WebCommandAnnotation,
} from "@workglow/cli";
import type { Command } from "commander";
import { formatChoicesByPath } from "./formatChoices";

/**
 * What sec's commands mean, said in the terms the console can render.
 *
 * Commander carries a flag's name and its help text and nothing else, so a
 * `<cik>` is a string, `--format` accepts anything, and `db reset` looks like
 * `db status`. These tables are where that is stated. Nothing here changes what
 * a command does — the CLI is unchanged and the terminal is unaffected.
 *
 * Vocabularies a value has to come FROM are named as a `format` and resolved by
 * the matching picker in `secFieldWidgets.ts`, which reads the live registries,
 * so a dropdown cannot offer a value the CLI would reject. Only closed
 * vocabularies with nowhere else to live are written out as `choices` here.
 */

const source = "@workglow/sec";

/** A CIK the picker searches by name, which is how anyone actually knows one. */
const CIK_FIELD = {
  format: "sec:cik",
  placeholder: "company name or CIK",
  description: "Filer CIK — search by company name",
} as const;

const DATE_FIELD = { placeholder: "YYYY-MM-DD" } as const;

/**
 * The field tables, as data.
 *
 * Declared rather than registered inline so the paths can be asserted against
 * the real command tree: an annotation whose path names nothing does not error,
 * it silently does not appear, which is a failure no other test would see.
 */
const FIELD_ANNOTATIONS: readonly CommandFieldAnnotations[] = [
  // The whole surface: the output vocabulary, and the CIK filter that appears
  // on a dozen unrelated commands under the same name.
  {
    path: ["**"],
    source,
    fields: {
      cik: CIK_FIELD,
      after: DATE_FIELD,
      before: DATE_FIELD,
      from: DATE_FIELD,
      to: DATE_FIELD,
    },
  },

  {
    path: ["query", "**"],
    source,
    fields: { search: { placeholder: "substring match" } },
  },
  {
    path: ["query", "facts"],
    source,
    fields: { cik: CIK_FIELD, year: { placeholder: "e.g. 2025" } },
  },
  {
    path: ["query", "xbrl"],
    source,
    fields: {
      // Scoped: the accessions worth offering are this filer's, and the picker
      // reads the `--cik` beside it to know which filer that is.
      accession: { format: "sec:accession", placeholder: "pick a --cik first" },
      concept: { placeholder: "e.g. AssetsHeldInTrust" },
    },
  },

  // Fetch: one company's submissions or facts.
  {
    path: ["fetch", "**"],
    source,
    fields: { cik: CIK_FIELD, form: { format: "sec:form", placeholder: "e.g. S-1, 424B4" } },
  },
];

/**
 * What each command costs, and which of them are worth stopping over.
 *
 * The badge vocabulary is deliberately coarse. An operator's question before
 * pressing Run is "does this spend money, hit EDGAR, run for an hour, or
 * destroy something" — four answers, not a cost model.
 */
const COMMAND_ANNOTATIONS: readonly WebCommandAnnotation[] = [
  {
    path: ["fetch", "**"],
    source,
    badges: ["network", "writes"],
    note: "Fetches from EDGAR under the shared rate limit and stores what it gets.",
  },
  {
    path: ["fetch", "golden-fixtures"],
    source,
    badges: ["network"],
    note: "Re-fetches the committed corpus from EDGAR. `--verify` writes nothing.",
  },

  {
    path: ["bootstrap", "**"],
    source,
    badges: ["network", "slow", "writes"],
    note: "A full-history pull is tens of TB decompressed and runs for hours. Bound it with --from/--to.",
  },

  {
    path: ["sync", "**"],
    source,
    badges: ["network", "slow", "writes"],
  },

  // The one command that destroys something. Its confirmation says what is lost
  // and what it would take to get it back — a dialog that only says "are you
  // sure" is a dialog that gets clicked through.
  {
    path: ["db", "reset"],
    source,
    badges: ["destructive"],
    note: "Drops every table this CLI owns.",
    confirm:
      "This drops every table sec owns, including ingested EDGAR data. Re-ingesting is hours of rate-limited fetching.",
  },
  {
    path: ["db", "setup"],
    source,
    badges: ["writes"],
    note: "Creates missing tables and columns, and widens Postgres columns in place. On a large deployment, run it in a maintenance window.",
  },
];

/** Path patterns, space-joined — asserted against the real command tree. */
export const SEC_FIELD_ANNOTATION_PATHS: readonly string[] = FIELD_ANNOTATIONS.map((entry) =>
  entry.path.join(" ")
);

export const SEC_COMMAND_ANNOTATION_PATHS: readonly string[] = COMMAND_ANNOTATIONS.map((entry) =>
  entry.path.join(" ")
);

/**
 * Annotates every command's `--format` from its own help text.
 *
 * Separate from the stated tables, and separately callable, because it reads
 * the PROGRAM: it can only cover commands registered before it runs. A superset
 * adds its groups after `AddCommands` returns, so it calls this again once its
 * own commands are on the program — otherwise its `--format` flags are the only
 * ones left as bare text boxes. Re-running is safe: annotations are keyed by
 * path, so a second pass replaces rather than duplicates.
 */
export function registerFormatChoiceAnnotations(program: Command): void {
  for (const [path, choices] of formatChoicesByPath(buildCommandTree(program))) {
    registerCommandFieldAnnotations({
      path: path.split(" "),
      source,
      fields: { format: { choices, description: "Output format" } },
    });
  }
}

export function registerSecFieldAnnotations(program?: Command): void {
  for (const annotations of FIELD_ANNOTATIONS) registerCommandFieldAnnotations(annotations);
  if (program) registerFormatChoiceAnnotations(program);
}

export function registerSecCommandAnnotations(): void {
  for (const annotation of COMMAND_ANNOTATIONS) registerCommandAnnotation(annotation);
}
