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
import { listResolverIds } from "../resolver/resolverExtensions";
import { SPAC_CANDIDATE_CONFIDENCES } from "../storage/spac/SpacCandidateSchema";
import { EXTRACTOR_IDS } from "../storage/versioning/extractorIds";

/**
 * What sec's commands mean, said in the terms the console can render.
 *
 * Commander carries a flag's name and its help text and nothing else, so a
 * `<cik>` is a string, `--format` accepts anything, and `db reset` looks like
 * `db status`. These tables are where that is stated. Nothing here changes what
 * a command does — the CLI is unchanged and the terminal is unaffected.
 *
 * Vocabularies are read from the same constants the commands validate against
 * (`EXTRACTOR_IDS`, `SPAC_CANDIDATE_CONFIDENCES`, the resolver registry) rather
 * than written out, so a dropdown cannot offer a value the CLI would reject.
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
  {
    path: ["query", "reg-a"],
    source,
    fields: {
      tier: { choices: ["Tier1", "Tier2"] },
      status: { choices: ["pending", "qualified", "reporting", "exit"] },
    },
  },
  {
    path: ["query", "person-roles"],
    source,
    fields: { cik: { ...CIK_FIELD, description: "Issuer CIK whose roster to read" } },
  },

  // Fetch: a form is picked from what this filer actually filed.
  {
    path: ["fetch", "**"],
    source,
    fields: { cik: CIK_FIELD, form: { format: "sec:form", placeholder: "e.g. S-1, 424B4" } },
  },
  {
    path: ["fetch", "form"],
    source,
    fields: { accession: { format: "sec:accession", placeholder: "optional — latest if omitted" } },
  },
  {
    path: ["fetch", "doc"],
    source,
    fields: { accession: { format: "sec:accession" } },
  },

  // Extractor ceremonies. The id carries its own version and worklist depth in
  // the picker, which is the pair that decides whether you want to run it.
  {
    path: ["extractor", "**"],
    source,
    fields: {
      // A picker rather than a plain dropdown: the id alone is not the
      // decision, the version it would run under and the depth of its worklist
      // are, and only the picker can show those beside it.
      extractorId: { format: "sec:extractor", placeholder: "e.g. S-1" },
      cik: CIK_FIELD,
    },
  },

  // Version ceremonies take a kind and then an id whose meaning depends on it.
  {
    path: ["version", "**"],
    source,
    fields: {
      kind: { choices: ["extractor", "resolver"], description: "Component kind" },
      id: {
        format: "sec:component-id",
        placeholder: "extractor id, or resolver kind",
        description: "Component id — the vocabulary depends on the kind chosen above",
      },
      semver: { placeholder: "e.g. 1.5.0" },
    },
  },

  {
    path: ["resolve"],
    source,
    fields: {
      kind: { format: "sec:resolver-kind", choices: [...listResolverIds()] },
      "resolver-version": { placeholder: "defaults to the active slot" },
    },
  },

  // Canonical alias ceremonies name two canonical rows, both of which exist.
  {
    path: ["canonical", "**"],
    source,
    fields: {
      kind: { format: "sec:resolver-kind" },
      from: { placeholder: "name to retire" },
      into: { placeholder: "name to keep" },
      fromName: { format: "sec:family", placeholder: "family to retire" },
      intoName: { format: "sec:family", placeholder: "family to keep" },
      name: { format: "sec:family" },
    },
  },

  // SPAC: two different populations, and the difference matters. `report` and
  // `history` read a `spac` row, so their picker offers only known SPACs;
  // `download` works off the cheap screen, so its picker offers candidates.
  {
    path: ["spac", "**"],
    source,
    fields: { cik: { format: "sec:spac-cik", placeholder: "known SPAC — search by name" } },
  },
  {
    // `--confidence` is a single rung here and a CSV list on `spac download`,
    // so the vocabulary is stated only where one value is what the flag takes.
    // A select cannot express `high,medium`, which is that command's default.
    path: ["spac", "candidates"],
    source,
    fields: {
      confidence: {
        choices: [...SPAC_CANDIDATE_CONFIDENCES],
        description: "Screen confidence to include",
      },
    },
  },
  {
    path: ["spac", "download", "*"],
    source,
    fields: {
      confidence: {
        placeholder: "high,medium",
        multiple: true,
        description: `Screen confidences to include, comma-separated (${SPAC_CANDIDATE_CONFIDENCES.join(", ")})`,
      },
    },
  },
  {
    path: ["spac", "process"],
    source,
    fields: { ciks: { format: "sec:spac-candidate-cik", multiple: true } },
  },

  {
    path: ["editorial", "**"],
    source,
    fields: {
      cik: { format: "sec:spac-cik" },
      "url-sponsor": { placeholder: "https://…" },
      "url-spac": { placeholder: "https://…" },
      details: { placeholder: '{"unit_price": 10}' },
    },
  },

  // Eval takes model ids as a list, so a pick appends rather than replaces.
  {
    path: ["eval", "**"],
    source,
    fields: {
      models: {
        format: "model",
        multiple: true,
        placeholder: "comma-separated model ids",
        description: "Candidate models to rank",
      },
      reference: { format: "model", description: "Oracle model, or 'golden' for committed labels" },
      extractor: { format: "sec:extractor" },
      extractors: { format: "sec:extractor", multiple: true },
      cik: { ...CIK_FIELD, multiple: true },
    },
  },

  {
    path: ["sync", "**"],
    source,
    fields: { shard: { placeholder: "i/n, e.g. 0/4" } },
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
    path: ["fetch", "form"],
    source,
    badges: ["network", "writes", "ai"],
    note: "Fetches the filing and runs its extractor — the AI sections included, which spend model quota.",
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
  {
    path: ["sync", "spacs", "**"],
    source,
    badges: ["network", "slow", "writes", "ai"],
    note: "Processing runs the S-1 / 424 / 8-K extractors, which call a model per section.",
  },
  {
    path: ["sync", "forms"],
    source,
    badges: ["network", "slow", "writes", "ai"],
  },

  {
    path: ["spac", "process"],
    source,
    badges: ["network", "slow", "writes", "ai"],
    note: "Runs the AI extractors over each CIK's filings.",
  },
  {
    path: ["spac", "download"],
    source,
    badges: ["network", "slow", "writes"],
    note: "Fills the document cache only — no extractors run. `--force` deletes each cached file before re-fetching it, so a failed re-fetch leaves nothing.",
  },
  {
    path: ["spac", "backfill-despac"],
    source,
    badges: ["writes"],
  },
  {
    path: ["spac", "backfill-trust"],
    source,
    badges: ["writes"],
  },
  {
    path: ["spac", "backfill-redemptions"],
    source,
    badges: ["writes", "ai", "slow"],
  },
  {
    path: ["spac", "backfill-lois"],
    source,
    badges: ["writes", "ai", "slow"],
  },
  {
    path: ["spac", "backfill-merger-proxies"],
    source,
    badges: ["writes", "ai", "slow"],
  },

  {
    path: ["extractor", "backfill"],
    source,
    badges: ["writes", "ai", "slow"],
    note: "Re-runs the whole form pipeline over every selected filing. `--dry-run` reports the worklist without spending anything.",
  },
  {
    path: ["extractor", "retry-dead-letters"],
    source,
    badges: ["writes", "ai"],
    note: "Re-runs the entries eligible under the current extractor version.",
  },

  { path: ["eval", "**"], source, badges: ["ai", "slow"] },
  {
    path: ["eval", "s1"],
    source,
    badges: ["ai", "slow"],
    note: "A bare sweep scores roughly 350 real sections per candidate model. Narrow it with --extractors or --cik.",
  },

  { path: ["resolve"], source, badges: ["writes", "slow"] },

  // The ceremonies that destroy something. Each confirmation says what is lost
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
  {
    path: ["version", "drop-previous"],
    source,
    badges: ["destructive"],
    confirm:
      "This purges the previous slot's data. For person/company it is rebuildable by re-resolving; for the family kinds it is not, which is why they refuse.",
  },
  {
    path: ["version", "drop-next"],
    source,
    badges: ["destructive"],
    confirm: "This discards the in-flight dev cycle and everything extracted under it.",
  },
  {
    path: ["version", "rollback"],
    source,
    badges: ["writes"],
    note: "Swaps the previous and current slots.",
  },
  {
    path: ["version", "promote"],
    source,
    badges: ["writes"],
    note: "Rotates next into current. A major bump is refused unless coverage is complete.",
  },
  {
    path: ["canonical", "*", "alias-remove"],
    source,
    badges: ["destructive"],
    note: "Removes a hand-curated claim that two canonical rows are one entity.",
  },
  {
    path: ["canonical", "*", "alias-import"],
    source,
    badges: ["writes"],
    note: "Resolves each pair by name; a pair whose target is not yet extracted is reported and skipped.",
  },
];

/** Path patterns, space-joined — asserted against the real command tree. */
export const SEC_FIELD_ANNOTATION_PATHS: readonly string[] = FIELD_ANNOTATIONS.map((entry) =>
  entry.path.join(" ")
);

export const SEC_COMMAND_ANNOTATION_PATHS: readonly string[] = COMMAND_ANNOTATIONS.map((entry) =>
  entry.path.join(" ")
);

export function registerSecFieldAnnotations(program?: Command): void {
  for (const annotations of FIELD_ANNOTATIONS) registerCommandFieldAnnotations(annotations);
  if (!program) return;
  // `--format` is annotated per command from the command's own help text rather
  // than from a stated list, because this CLI declares six different format
  // vocabularies and no single list is right for all of them.
  for (const [path, choices] of formatChoicesByPath(buildCommandTree(program))) {
    registerCommandFieldAnnotations({
      path: path.split(" "),
      source,
      fields: { format: { choices, description: "Output format" } },
    });
  }
}

export function registerSecCommandAnnotations(): void {
  for (const annotation of COMMAND_ANNOTATIONS) registerCommandAnnotation(annotation);
}
