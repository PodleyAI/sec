import { InvalidArgumentError, type Command } from "commander";

export interface GlobalOptions {
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly quiet: boolean;
}

// `--dry-run` gates writes via SEC_DRY_RUN; `--json` routes status/error output
// through SEC_JSON_OUTPUT so `statusMessage` / `runCommand` emit machine-parseable
// JSON instead of pretty text. (The `--verbose` / `--no-color` flags were parsed
// but never consumed, so they stay unadvertised.)
export function applyGlobalOptions(program: Command): Command {
  return program
    .option("--dry-run", "Show what would happen without changes", false)
    .option("--json", "Emit status and error output as machine-parseable JSON", false)
    .option("--quiet", "Suppress the suggested next commands", false);
}

export function parseGlobalOptions(cmd: Command): GlobalOptions {
  const opts = cmd.opts();
  return {
    dryRun: opts.dryRun ?? false,
    json: opts.json ?? false,
    quiet: opts.quiet ?? false,
  };
}

export function parseIntOption(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
    throw new InvalidArgumentError(`"${value}" is not a non-negative integer.`);
  }
  return Number(trimmed);
}

/** The output formats `renderTable` understands. */
export const OUTPUT_FORMATS = ["table", "csv", "json"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * Commander parser for a `--format` option. Rejects an unrecognised value at
 * parse time rather than silently rendering a table — a `--format jsonl` that
 * quietly produced a table would look like the command ignoring the flag, and
 * a script piping the output would only find out downstream.
 */
export function parseOutputFormat(value: string): OutputFormat {
  const trimmed = value.trim().toLowerCase();
  if (!(OUTPUT_FORMATS as readonly string[]).includes(trimmed)) {
    throw new InvalidArgumentError(`"${value}" is not one of: ${OUTPUT_FORMATS.join(" | ")}.`);
  }
  return trimmed as OutputFormat;
}
