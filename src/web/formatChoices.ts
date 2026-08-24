/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebCommandNode } from "@workglow/cli";

/**
 * The `--format` vocabulary of one command, read off its own help text.
 *
 * A single stated list would be wrong. `--format` is declared six different
 * ways across this CLI — `table, json, csv` on the query group, `table, json`
 * on db/version, `text | json` on `spac report`, `text | tsv` on the alias
 * exports, `table | csv | json` on `spac candidates` — so annotating them all
 * with one vocabulary offers `csv` where the command rejects it and omits the
 * value the command DEFAULTS to. A dropdown that cannot express the current
 * value is worse than the text box it replaced.
 *
 * Every one of those declarations already names its values in the description
 * commander prints, so that is what is read. It cannot drift: a command that
 * changes its formats changes its help text in the same edit, and one whose
 * description states no list keeps its plain text box.
 *
 * Deliberately scoped to options NAMED `format`. The same parse over every
 * option would fire on things that merely look like lists — a CSV-valued
 * `--confidence high,medium`, a `--shard i/n` — and turn a free-text field into
 * a single-select that cannot express what the flag actually takes.
 */

/** A stated value: lowercase, possibly hyphenated. Nothing here is a sentence. */
const TOKEN = /^[a-z][a-z0-9-]*$/;

/** `(default: table)` and friends, which name a value without offering it. */
const DEFAULT_CLAUSE = /\(\s*default[^)]*\)/gi;

/**
 * Pulls the vocabulary out of one option description.
 *
 * Returns undefined unless the result is unambiguous: at least two tokens, all
 * token-shaped, and — when the command declares a default — that default among
 * them. The last condition is the load-bearing one: a parse that drops the
 * command's own default has misread the description, and offering the result
 * would leave the form unable to state the value the CLI would use anyway.
 */
export function inferFormatChoices(
  description: string,
  defaultValue: string | boolean | undefined
): readonly string[] | undefined {
  const cleaned = description.replace(DEFAULT_CLAUSE, " ");
  // The list is whatever follows the last `(` or `:`; a description with
  // neither ("table | json") is taken whole.
  const after = cleaned.slice(Math.max(cleaned.lastIndexOf("("), cleaned.lastIndexOf(":")) + 1);
  const tokens = after
    .replace(/\)/g, " ")
    .split(/[,|]/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");
  if (tokens.length < 2 || !tokens.every((token) => TOKEN.test(token))) return undefined;
  if (typeof defaultValue === "string" && !tokens.includes(defaultValue.toLowerCase())) {
    return undefined;
  }
  return tokens;
}

/**
 * Every command whose `--format` states a vocabulary, paired with it.
 *
 * Walked once at registration, when the program is fully built — the tree is
 * the same one the console reads, so a command added later is covered by the
 * same pass with nothing to update here.
 */
export function formatChoicesByPath(
  nodes: readonly WebCommandNode[]
): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, readonly string[]>();
  const walk = (candidates: readonly WebCommandNode[]): void => {
    for (const node of candidates) {
      const option = node.options.find((candidate) => candidate.name === "format");
      if (option) {
        const choices = inferFormatChoices(option.description, option.defaultValue);
        if (choices) found.set(node.path.join(" "), choices);
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return found;
}
