import type { Command } from "commander";

export interface GlobalOptions {
  readonly dryRun: boolean;
  readonly json: boolean;
}

// `--dry-run` gates writes via SEC_DRY_RUN; `--json` routes status/error output
// through SEC_JSON_OUTPUT so `statusMessage` / `runCommand` emit machine-parseable
// JSON instead of pretty text. (The `--verbose` / `--no-color` flags were parsed
// but never consumed, so they stay unadvertised.)
export function applyGlobalOptions(program: Command): Command {
  return program
    .option("--dry-run", "Show what would happen without changes", false)
    .option("--json", "Emit status and error output as machine-parseable JSON", false);
}

export function parseGlobalOptions(cmd: Command): GlobalOptions {
  const opts = cmd.opts();
  return {
    dryRun: opts.dryRun ?? false,
    json: opts.json ?? false,
  };
}

export function parseIntOption(value: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`"${value}" is not a valid number`);
  }
  return parsed;
}
