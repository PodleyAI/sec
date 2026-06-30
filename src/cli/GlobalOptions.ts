import type { Command } from "commander";

export interface GlobalOptions {
  readonly dryRun: boolean;
}

// Only `--dry-run` is wired (it gates writes via SEC_DRY_RUN). Previous
// `--json` / `--verbose` / `--no-color` flags were parsed but never consumed —
// read commands carry their own `--format`, and output is plain text — so they
// were removed rather than advertised in --help while doing nothing.
export function applyGlobalOptions(program: Command): Command {
  return program.option("--dry-run", "Show what would happen without changes", false);
}

export function parseGlobalOptions(cmd: Command): GlobalOptions {
  const opts = cmd.opts();
  return {
    dryRun: opts.dryRun ?? false,
  };
}

export function parseIntOption(value: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`"${value}" is not a valid number`);
  }
  return parsed;
}
